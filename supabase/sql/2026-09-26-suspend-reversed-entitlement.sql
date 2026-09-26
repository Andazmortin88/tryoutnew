-- Applied to production on 2026-09-26. Preserve actual paid ledger entries.
-- When Midtrans confirms a reversal of the order currently backing a Premium
-- subscription, suspend access and cancel ongoing non-trial sessions.
-- A later independently paid order reactivates for 30 days from that payment;
-- active subscriptions still extend from their current expiry.
-- Partial refunds also suspend access pending manual financial review.
-- Existing EXECUTE grants remain service_role-only.
CREATE OR REPLACE FUNCTION public.apply_paid_midtrans_transaction(p_order_id text, p_transaction_status text, p_payment_method text, p_gateway_transaction_id text, p_raw_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trx public.transactions%rowtype;
  v_now timestamptz:=now();
  v_current public.subscriptions%rowtype;
  v_base timestamptz;
  v_exp timestamptz;
  v_status text:=lower(coalesce(nullif(btrim(p_transaction_status),''),'unknown'));
  v_is_paid boolean;
  v_is_reversal boolean;
begin
  if coalesce(btrim(p_order_id),'')='' then raise exception 'ORDER_ID_REQUIRED'; end if;

  select * into v_trx
  from public.transactions
  where order_id=p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',true,'ignored',true,'reason','ORDER_NOT_FOUND');
  end if;

  -- Serialize entitlement changes for the same user/program, even across distinct orders.
  perform pg_advisory_xact_lock(hashtextextended(v_trx.user_id::text||':'||v_trx.program,0));

  v_is_paid:=v_status in ('settlement','capture');
  v_is_reversal:=v_status in ('refund','partial_refund','chargeback','cancel','deny','expire');

  insert into public.payment_events(
    transaction_id,order_id,gateway_status,status_code,fraud_status,
    payment_method,gateway_transaction_id,amount_text,raw_response
  ) values(
    v_trx.id,v_trx.order_id,v_status,
    p_raw_response->>'status_code',p_raw_response->>'fraud_status',
    p_payment_method,p_gateway_transaction_id,p_raw_response->>'gross_amount',
    coalesce(p_raw_response,'{}'::jsonb)
  );

  -- Always retain latest gateway status, including post-settlement reversals.
  update public.transactions
  set transaction_status=v_status,
      payment_method=coalesce(p_payment_method,payment_method),
      gateway_transaction_id=coalesce(p_gateway_transaction_id,gateway_transaction_id),
      raw_response=coalesce(p_raw_response,'{}'::jsonb),
      last_gateway_status_at=v_now,
      payment_review_required=case
        when v_is_reversal and subscription_applied_at is not null then true
        else payment_review_required
      end
  where id=v_trx.id;

  if v_is_reversal then
    -- Suspend only the entitlement granted by the reversed order. A later
    -- independently paid order is not affected by an older reversal.
    if v_trx.subscription_applied_at is not null then
      update public.subscriptions
      set status='suspended'
      where user_id=v_trx.user_id
        and program=v_trx.program
        and transaction_id=v_trx.id
        and status='active';

      if found then
        update public.exam_sessions
        set cancelled_at=coalesce(cancelled_at,v_now), updated_at=v_now
        where user_id=v_trx.user_id
          and program=v_trx.program
          and mode<>'trial'
          and submitted_at is null
          and cancelled_at is null;
      end if;
    end if;

    return jsonb_build_object(
      'ok',true,
      'paid',false,
      'reversal',true,
      'review_required',v_trx.subscription_applied_at is not null,
      'status',v_status,
      'order_id',v_trx.order_id
    );
  end if;

  if not v_is_paid then
    return jsonb_build_object('ok',true,'paid',false,'status',v_status,'order_id',v_trx.order_id);
  end if;

  -- Preserve an owner-confirmed test payment in the financial ledger without
  -- granting access or sending a delayed success email on webhook replay.
  if v_trx.payment_resolution='owner_test_no_entitlement' then
    return jsonb_build_object(
      'ok',true,'paid',true,'hold_email',true,'no_new_entitlement',true,
      'order_id',v_trx.order_id,'reason','OWNER_TEST_PAYMENT_CLOSED'
    );
  end if;

  -- A previously paid order without an entitlement marker is not safe to replay
  -- after a later settled order has already granted access to this account.
  -- Hold it for reconciliation instead of granting another 30 days.
  if v_trx.subscription_applied_at is null and (
    v_trx.payment_review_required
    or (
      v_trx.paid_at is not null and exists (
        select 1 from public.transactions later
        where later.user_id=v_trx.user_id
          and later.program=v_trx.program
          and later.id<>v_trx.id
          and later.subscription_applied_at is not null
          and later.paid_at>=v_trx.paid_at
      )
    )
  ) then
    update public.transactions
    set payment_review_required=true
    where id=v_trx.id;

    return jsonb_build_object(
      'ok',true,'paid',true,'review_required',true,
      'order_id',v_trx.order_id,'program',v_trx.program,
      'reason','HISTORICAL_PAYMENT_RECONCILIATION_REQUIRED'
    );
  end if;

  if v_trx.subscription_applied_at is not null then
    select s.expires_at into v_exp
    from public.subscriptions s
    where s.user_id=v_trx.user_id and s.program=v_trx.program
    limit 1;

    return jsonb_build_object(
      'ok',true,'paid',true,'idempotent',true,
      'order_id',v_trx.order_id,'program',v_trx.program,
      'user_id',v_trx.user_id,'expires_at',v_exp,
      'subscription_applied_at',v_trx.subscription_applied_at
    );
  end if;

  update public.transactions
  set paid_at=coalesce(paid_at,v_now)
  where id=v_trx.id;

  select * into v_current
  from public.subscriptions
  where user_id=v_trx.user_id and program=v_trx.program
  for update;

  if found then
    v_base:=case when v_current.status='active' and v_current.expires_at is not null and v_current.expires_at>v_now
                 then v_current.expires_at else v_now end;
    v_exp:=v_base+interval '30 days';

    update public.subscriptions
    set plan='launch_30',
        plan_code='launch_30',
        amount=v_trx.amount,
        status='active',
        starts_at=coalesce(starts_at,v_now),
        expires_at=v_exp,
        ends_at=v_exp,
        transaction_id=v_trx.id,
        provider='midtrans',
        provider_reference=coalesce(p_gateway_transaction_id,p_order_id)
    where id=v_current.id;
  else
    v_exp:=v_now+interval '30 days';

    insert into public.subscriptions(
      user_id,program,plan,plan_code,amount,status,
      starts_at,expires_at,ends_at,transaction_id,provider,provider_reference
    ) values(
      v_trx.user_id,v_trx.program,'launch_30','launch_30',v_trx.amount,'active',
      v_now,v_exp,v_exp,v_trx.id,'midtrans',coalesce(p_gateway_transaction_id,p_order_id)
    )
    on conflict(user_id,program) do update
    set plan='launch_30',
        plan_code='launch_30',
        amount=excluded.amount,
        status='active',
        expires_at=(case when public.subscriptions.status='active' then greatest(coalesce(public.subscriptions.expires_at,v_now),v_now) else v_now end)+interval '30 days',
        ends_at=(case when public.subscriptions.status='active' then greatest(coalesce(public.subscriptions.expires_at,v_now),v_now) else v_now end)+interval '30 days',
        transaction_id=excluded.transaction_id,
        provider='midtrans',
        provider_reference=excluded.provider_reference
    returning expires_at into v_exp;
  end if;

  update public.transactions
  set subscription_applied_at=v_now,payment_review_required=false
  where id=v_trx.id;

  return jsonb_build_object(
    'ok',true,'paid',true,'idempotent',false,
    'order_id',v_trx.order_id,'user_id',v_trx.user_id,
    'program',v_trx.program,'expires_at',v_exp,'amount',v_trx.amount
  );
end
$function$
;
