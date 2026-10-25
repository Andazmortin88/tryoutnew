-- Release candidate: 4 paid plans + free trial of 10 questions (2026-10-25).
-- Apply with Supabase migration after testing in staging.
-- Historic orders retain plan launch_30; unfinished legacy 20-question trials remain finishable.
-- All prices and durations are enforced in SQL; never trust client-supplied amounts.

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS plan_code text NOT NULL DEFAULT 'launch_30';

-- apply_paid_midtrans_transaction(p_order_id text, p_transaction_status text, p_payment_method text, p_gateway_transaction_id text, p_raw_response jsonb)
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
  v_plan text;
  v_days integer;
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

  v_plan:=coalesce(v_trx.plan_code,'launch_30');
  v_days:=case v_plan when 'sprint_3' then 3 when 'intensif_7' then 7 when 'launch_30' then 30 when 'promo_90' then 90 end;
  if v_days is null then raise exception 'INVALID_TRANSACTION_PLAN'; end if;

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
    v_exp:=v_base+make_interval(days => v_days);

    update public.subscriptions
    set plan=v_plan,
        plan_code=v_plan,
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
    v_exp:=v_now+make_interval(days => v_days);

    insert into public.subscriptions(
      user_id,program,plan,plan_code,amount,status,
      starts_at,expires_at,ends_at,transaction_id,provider,provider_reference
    ) values(
      v_trx.user_id,v_trx.program,v_plan,v_plan,v_trx.amount,'active',
      v_now,v_exp,v_exp,v_trx.id,'midtrans',coalesce(p_gateway_transaction_id,p_order_id)
    )
    on conflict(user_id,program) do update
    set plan=v_plan,
        plan_code=v_plan,
        amount=excluded.amount,
        status='active',
        expires_at=(case when public.subscriptions.status='active' then greatest(coalesce(public.subscriptions.expires_at,v_now),v_now) else v_now end)+make_interval(days => v_days),
        ends_at=(case when public.subscriptions.status='active' then greatest(coalesce(public.subscriptions.expires_at,v_now),v_now) else v_now end)+make_interval(days => v_days),
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
$function$;

-- reserve_checkout_order(p_user_id uuid, p_program text, p_plan text, p_request_id uuid)
CREATE OR REPLACE FUNCTION public.reserve_checkout_order(p_user_id uuid, p_program text, p_plan text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile_program text;
  v_existing public.transactions%rowtype;
  v_count int;
  v_id uuid:=gen_random_uuid();
  v_order_id text;
  v_amount int;
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  if p_program not in ('ners','d3','bidan','apoteker') then raise exception 'INVALID_PROGRAM'; end if;
  if coalesce(p_plan,'launch_30') not in ('sprint_3','intensif_7','launch_30','promo_90') then raise exception 'INVALID_PLAN'; end if;
  v_amount:=case coalesce(p_plan,'launch_30') when 'sprint_3' then 20000 when 'intensif_7' then 29900 when 'launch_30' then 40000 when 'promo_90' then 79900 end;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_program||':checkout',0));

  select program into v_profile_program from public.profiles where id=p_user_id;
  if v_profile_program is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_profile_program<>p_program then raise exception 'PROGRAM_MISMATCH'; end if;

  select * into v_existing
  from public.transactions
  where checkout_request_id=p_request_id
  limit 1;

  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.program is distinct from p_program then
      raise exception 'CHECKOUT_REQUEST_OWNER_MISMATCH';
    end if;
    if v_existing.plan_code is distinct from coalesce(p_plan,'launch_30') then raise exception 'CHECKOUT_REQUEST_PLAN_MISMATCH'; end if;
    return jsonb_build_object(
      'transaction_id',v_existing.id,
      'order_id',v_existing.order_id,
      'amount',v_existing.amount,
      'redirect_url',v_existing.raw_response->>'redirect_url',
      'reused',true,
      'in_progress',(v_existing.raw_response->>'redirect_url') is null
                    and v_existing.transaction_status in ('creating','pending')
    );
  end if;

  select * into v_existing
  from public.transactions
  where user_id=p_user_id
    and program=p_program
    and created_at>=now()-interval '2 minutes'
    and transaction_status in ('creating','pending')
    and plan_code=coalesce(p_plan,'launch_30')
  order by created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'transaction_id',v_existing.id,
      'order_id',v_existing.order_id,
      'amount',v_existing.amount,
      'redirect_url',v_existing.raw_response->>'redirect_url',
      'reused',true,
      'in_progress',(v_existing.raw_response->>'redirect_url') is null
    );
  end if;

  select count(*) into v_count
  from public.transactions
  where user_id=p_user_id
    and created_at>=now()-interval '1 hour';

  if v_count>=10 then raise exception 'CHECKOUT_RATE_LIMIT'; end if;

  v_order_id:='UKOM-'||upper(p_program)||'-'||
    floor(extract(epoch from clock_timestamp())*1000)::bigint::text||'-'||
    substr(replace(gen_random_uuid()::text,'-',''),1,8);

  insert into public.transactions(
    id,user_id,order_id,program,plan_code,amount,gateway,transaction_status,
    checkout_request_id,checkout_started_at,raw_response
  ) values(
    v_id,p_user_id,v_order_id,p_program,coalesce(p_plan,'launch_30'),v_amount,'midtrans','creating',
    p_request_id,now(),'{}'::jsonb
  );

  return jsonb_build_object(
    'transaction_id',v_id,
    'order_id',v_order_id,
    'amount',v_amount,
    'redirect_url',null,
    'reused',false,
    'in_progress',false
  );
end
$function$;

-- start_exam_session(p_mode text, p_area text, p_count integer, p_ids bigint[])
CREATE OR REPLACE FUNCTION public.start_exam_session(p_mode text, p_area text DEFAULT NULL::text, p_count integer DEFAULT 20, p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_program text;
  v_role text;
  v_premium boolean:=false;
  v_mode text:=lower(coalesce(nullif(btrim(p_mode),''),''));
  v_count integer;
  v_ids bigint[];
  v_sid uuid;
  v_created timestamptz;
  v_expires timestamptz;
  v_orders jsonb;
  v_questions jsonb;
  v_trial_consumed timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_mode not in ('trial','learn','tryout','wrong') then raise exception 'INVALID_MODE'; end if;

  select p.program,coalesce(p.role,'student')
  into v_program,v_role
  from public.profiles p where p.id=v_uid;

  if v_program is null then raise exception 'PROFILE_INCOMPLETE'; end if;
  if v_program = 'apoteker' then raise exception 'CLIENT_UPDATE_REQUIRED'; end if;

  select exists(
    select 1 from public.subscriptions s
    where s.user_id=v_uid and s.program=v_program and s.status='active'
      and (s.expires_at is null or s.expires_at>now())
  ) into v_premium;
  v_premium:=v_premium or v_role='super_admin';

  if v_mode<>'trial' and not v_premium then raise exception 'PREMIUM_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||v_program||':'||v_mode,0));

  if v_mode='trial' then
    insert into public.trial_entitlements(user_id,program)
    values(v_uid,v_program)
    on conflict(user_id,program) do nothing;

    select consumed_at into v_trial_consumed
    from public.trial_entitlements
    where user_id=v_uid and program=v_program
    for update;

    if v_trial_consumed is not null then raise exception 'TRIAL_ALREADY_USED'; end if;
    v_count:=10;
  elsif v_mode='tryout' then
    v_count:=180;
  elsif v_mode='learn' then
    v_count:=least(greatest(coalesce(p_count,20),1),50);
  else
    v_count:=least(greatest(coalesce(p_count,20),1),180);
  end if;

  -- Reuse active session for repeat/double-click/resume.
  select es.id,es.question_ids,es.created_at,es.expires_at,es.option_orders
  into v_sid,v_ids,v_created,v_expires,v_orders
  from public.exam_sessions es
  where es.user_id=v_uid and es.program=v_program and es.mode=v_mode
    and es.submitted_at is null and es.cancelled_at is null
    and es.expires_at>now()
  order by es.created_at desc
  limit 1
  for update;

  if v_sid is null then
    update public.exam_sessions
    set cancelled_at=coalesce(cancelled_at,now()),updated_at=now()
    where user_id=v_uid and program=v_program and mode=v_mode
      and submitted_at is null and cancelled_at is null
      and expires_at<=now();

    if v_mode='wrong' then
      select coalesce(array_agg(id order by random()),array[]::bigint[])
      into v_ids
      from (
        select distinct q.id
        from public.questions q
        join public.attempt_answers aa on aa.question_id=q.id and aa.is_correct=false
        join public.attempts a on a.id=aa.attempt_id and a.user_id=v_uid
        where q.program=v_program and q.is_active=true
          and (p_ids is null or q.id=any(p_ids))
        limit v_count
      ) s;
    else
      select coalesce(array_agg(id order by random()),array[]::bigint[])
      into v_ids
      from (
        select q.id
        from public.questions q
        where q.program=v_program and q.is_active=true
          and (p_area is null or btrim(p_area)='' or p_area='Semua' or q.area=p_area)
        order by random()
        limit v_count
      ) s;
    end if;

    if cardinality(v_ids)=0 then raise exception 'NO_QUESTIONS_AVAILABLE'; end if;
    if v_mode in ('trial','tryout') and cardinality(v_ids)<>v_count then
      raise exception 'INSUFFICIENT_QUESTION_COUNT';
    end if;

    select jsonb_object_agg(qid::text,to_jsonb(ordarr))
    into v_orders
    from (
      select qid,
        array(select i from generate_series(0,4) g(i) order by random())::int[] ordarr
      from unnest(v_ids) qid
    ) z;

    v_created:=now();
    v_expires:=case
      when v_mode='tryout' then v_created+interval '180 minutes'
      else v_created+interval '7 days'
    end;

    insert into public.exam_sessions(
      user_id,program,mode,area,question_ids,created_at,expires_at,
      option_orders,expected_count,randomize,updated_at
    ) values(
      v_uid,v_program,v_mode,p_area,v_ids,v_created,v_expires,
      v_orders,cardinality(v_ids),true,now()
    )
    returning id into v_sid;

    if v_mode='trial' then
      update public.trial_entitlements
      set first_session_id=coalesce(first_session_id,v_sid),updated_at=now()
      where user_id=v_uid and program=v_program;
    end if;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',q.id,
      'area',q.area,
      'subtopic',q.subtopic,
      'vignette',q.vignette,
      'options',jsonb_build_array(
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(v_orders->q.id::text->>0)::int+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(v_orders->q.id::text->>1)::int+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(v_orders->q.id::text->>2)::int+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(v_orders->q.id::text->>3)::int+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(v_orders->q.id::text->>4)::int+1]
      ),
      'difficulty',q.difficulty,
      'cognitive_level',q.cognitive_level,
      'blueprint_tag',q.blueprint_tag
    ) order by u.ord
  ),'[]'::jsonb)
  into v_questions
  from unnest(v_ids) with ordinality u(qid,ord)
  join public.questions q on q.id=u.qid and q.program=v_program and q.is_active=true;

  return jsonb_build_object(
    'session_id',v_sid,
    'program',v_program,
    'mode',v_mode,
    'area',p_area,
    'started_at',v_created,
    'expires_at',v_expires,
    'expected_count',cardinality(v_ids),
    'questions',v_questions
  );
end
$function$;

-- start_exam_session(p_mode text, p_limit integer, p_area text, p_ids bigint[], p_randomize boolean)
CREATE OR REPLACE FUNCTION public.start_exam_session(p_mode text DEFAULT 'trial'::text, p_limit integer DEFAULT 20, p_area text DEFAULT NULL::text, p_ids bigint[] DEFAULT NULL::bigint[], p_randomize boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_program text; v_role text; v_premium boolean:=false;
  v_mode text:=lower(coalesce(nullif(btrim(p_mode),''),'trial')); v_limit integer;
  v_ids bigint[]; v_id bigint; v_perm int[]; v_orders jsonb:='{}'::jsonb;
  v_session_id uuid; v_existing public.exam_sessions%rowtype; v_active_count integer;
  v_consumed timestamptz; v_expires timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_mode not in ('trial','learn','tryout','wrong') then raise exception 'INVALID_MODE'; end if;

  select p.program,coalesce(p.role,'student') into v_program,v_role
  from public.profiles p where p.id=v_uid;
  if v_program is null then raise exception 'PROFILE_INCOMPLETE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||v_program||':exam',0));

  select exists(select 1 from public.subscriptions s
    where s.user_id=v_uid and s.program=v_program and s.status='active'
      and (s.expires_at is null or s.expires_at>now()))
  into v_premium;
  v_premium:=v_premium or v_role='super_admin';

  if v_mode='trial' then
    insert into public.trial_entitlements(user_id,program,created_at,updated_at)
    values(v_uid,v_program,now(),now())
    on conflict(user_id,program) do nothing;

    select te.consumed_at into v_consumed
    from public.trial_entitlements te
    where te.user_id=v_uid and te.program=v_program
    for update;
    if v_consumed is not null then raise exception 'TRIAL_ALREADY_USED'; end if;
  elsif not v_premium then
    raise exception 'PREMIUM_REQUIRED';
  end if;

  -- Only one active exam session per account/program at a time.
  select * into v_existing
  from public.exam_sessions es
  where es.user_id=v_uid and es.program=v_program
    and es.submitted_at is null and es.cancelled_at is null
    and (es.mode='trial' or es.expires_at>now())
  order by es.updated_at desc,es.created_at desc
  limit 1
  for update;

  if found then
    return public._exam_session_payload(v_existing.id,v_uid)
      ||jsonb_build_object('resumed',true);
  end if;

  update public.exam_sessions
  set cancelled_at=coalesce(cancelled_at,now()),updated_at=now()
  where user_id=v_uid and program=v_program
    and submitted_at is null and cancelled_at is null
    and mode<>'trial' and expires_at<=now();

  if v_mode='trial' then
    v_limit:=10; v_expires:=now()+interval '365 days';
  elsif v_mode='tryout' then
    v_limit:=case when v_program='apoteker' then 200 else 180 end; v_expires:=now()+interval '180 minutes';
    select count(*) into v_active_count
    from public.questions q where q.program=v_program and q.is_active;
    if v_active_count<v_limit then raise exception 'TRYOUT_REQUIRES_FULL_QUESTION_BANK'; end if;
    p_area:=null; p_ids:=null;
  elsif v_mode='wrong' then
    if p_ids is null or cardinality(p_ids)=0 then raise exception 'WRONG_IDS_REQUIRED'; end if;
    v_limit:=least(cardinality(p_ids),case when v_program='apoteker' then 200 else 180 end); v_expires:=now()+interval '24 hours';
  else
    v_limit:=least(greatest(coalesce(p_limit,20),1),50);
    v_expires:=now()+interval '24 hours';
  end if;

  if v_mode='trial' then
    -- A single curated trial set per program, independent of the account.
    select coalesce(array_agg(q.id order by random()),array[]::bigint[])
    into v_ids
    from public.questions q
    where q.program=v_program and q.is_active
      and q.id=any(case v_program
        when 'ners' then array[174,42,100,98,168,4,148,89,80,84,145,133,34,24,151,90,97,161,68,56]::bigint[]
        when 'd3' then array[1087,1083,1161,1156,1130,1136,1108,1100,1125,1113,1010,1053,1046,1166,1169,1147,1142,1061,1066,1067]::bigint[]
        when 'bidan' then array[2175,2169,2163,2157,2166,2030,2052,2045,2127,2139,2142,2114,2105,2100,2076,2081,2090,2015,2004,2012]::bigint[]
        when 'apoteker' then (select array_agg(id order by external_id) from public.questions where program='apoteker' and external_id in ('UHP-APT-2026-001','UHP-APT-2026-010','UHP-APT-2026-021','UHP-APT-2026-030','UHP-APT-2026-041','UHP-APT-2026-050','UHP-APT-2026-061','UHP-APT-2026-070','UHP-APT-2026-080','UHP-APT-2026-090','UHP-APT-2026-100','UHP-APT-2026-110','UHP-APT-2026-121','UHP-APT-2026-130','UHP-APT-2026-140','UHP-APT-2026-150','UHP-APT-2026-160','UHP-APT-2026-170','UHP-APT-2026-181','UHP-APT-2026-190'))
        else array[]::bigint[] end);
    -- Draw 10 free questions from the existing 20-item curated pool.
    v_ids:=v_ids[1:10];
  elsif v_mode='wrong' then
    select coalesce(array_agg(x.id order by x.ord),array[]::bigint[])
    into v_ids
    from (
      select distinct q.id,row_number() over() ord
      from public.questions q
      join public.attempt_answers aa on aa.question_id=q.id and aa.is_correct=false
      join public.attempts a on a.id=aa.attempt_id and a.user_id=v_uid
      where q.program=v_program and q.is_active
        and q.id=any(p_ids)
      order by random()
      limit v_limit
    ) x;
  else
    select coalesce(array_agg(x.id order by x.ord),array[]::bigint[])
    into v_ids
    from (
      select q.id,row_number() over() ord
      from public.questions q
      where q.program=v_program and q.is_active
        and (p_area is null or btrim(p_area)='' or p_area='Semua' or q.area=p_area)
      order by random()
      limit v_limit
    ) x;
  end if;

  if cardinality(v_ids)=0 then raise exception 'NO_ACTIVE_QUESTIONS'; end if;
  if v_mode='trial' and cardinality(v_ids)<>10 then raise exception 'TRIAL_REQUIRES_10_QUESTIONS'; end if;
  if v_mode='tryout' and cardinality(v_ids)<>v_limit then raise exception 'TRYOUT_REQUIRES_FULL_QUESTION_BANK'; end if;

  -- Always randomize on the server. Client cannot request deterministic A-E order.
  foreach v_id in array v_ids loop
    select array_agg(i order by random()) into v_perm from generate_series(0,4) g(i);
    v_orders:=v_orders||jsonb_build_object(v_id::text,to_jsonb(v_perm));
  end loop;

  insert into public.exam_sessions(
    user_id,program,mode,area,question_ids,option_orders,
    expected_count,expires_at,randomize,created_at,updated_at,answers
  )
  values(
    v_uid,v_program,v_mode,p_area,v_ids,v_orders,
    cardinality(v_ids),v_expires,true,now(),now(),'[]'::jsonb
  )
  returning id into v_session_id;

  if v_mode='trial' then
    update public.trial_entitlements
    set first_session_id=coalesce(first_session_id,v_session_id),updated_at=now()
    where user_id=v_uid and program=v_program;
  end if;

  return public._exam_session_payload(v_session_id,v_uid)
    ||jsonb_build_object('resumed',false);
end
$function$;

-- submit_exam_session(p_session_id uuid, p_answers jsonb)
CREATE OR REPLACE FUNCTION public.submit_exam_session(p_session_id uuid, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_s public.exam_sessions%rowtype;
  v_attempt_id uuid;
  v_total int; v_answered int; v_correct int; v_wrong int;
  v_score numeric(5,2); v_by_area jsonb; v_wrong_ids jsonb;
  v_now timestamptz:=now();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'array' then raise exception 'INVALID_ANSWERS_PAYLOAD'; end if;

  select * into v_s from public.exam_sessions
  where id=p_session_id and user_id=v_uid
  for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.attempt_id is not null then return public._attempt_payload(v_s.attempt_id,v_uid); end if;
  if v_s.cancelled_at is not null then raise exception 'SESSION_CANCELLED'; end if;
  if v_s.mode='tryout' and v_now>v_s.expires_at+interval '30 seconds' then raise exception 'SESSION_EXPIRED'; end if;

  select count(*),count(distinct x.question_id)
  into v_total,v_answered
  from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean);
  if v_total<>v_s.expected_count or v_total<>v_answered then raise exception 'SESSION_QUESTION_COUNT_MISMATCH'; end if;
  -- Keep pre-release 20-item free sessions finishable.
  if v_s.mode='trial' and v_total not in (10,20) then raise exception 'TRIAL_REQUIRES_10_OR_LEGACY_20'; end if;
  if v_s.mode='tryout' and v_total<>(case when v_s.program='apoteker' then 200 else 180 end) then raise exception 'TRYOUT_REQUIRES_FULL_QUESTION_BANK'; end if;

  if exists(
    select 1 from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean)
    where x.question_id is null
      or not(x.question_id=any(v_s.question_ids))
      or (x.selected_index is not null and (x.selected_index<0 or x.selected_index>4))
  ) then raise exception 'INVALID_ANSWER_OPTION'; end if;

  if (select count(*) from public.questions q where q.id=any(v_s.question_ids) and q.program=v_s.program and q.is_active)<>v_total
  then raise exception 'QUESTION_NOT_FOUND_PROGRAM_MISMATCH'; end if;

  with s as (
    select x.question_id,x.selected_index,x.is_flagged,
      case when x.selected_index is null then null
        else (v_s.option_orders->x.question_id::text->>x.selected_index)::int end original_selected
    from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean)
  )
  select count(*) filter(where s.selected_index is not null),
         count(*) filter(where s.selected_index is not null and s.original_selected=q.correct_option)
  into v_answered,v_correct
  from s join public.questions q on q.id=s.question_id and q.program=v_s.program;

  v_wrong:=greatest(v_answered-v_correct,0);
  v_score:=round((100.0*v_correct/nullif(v_total,0))::numeric,2);

  with s as (
    select x.question_id,x.selected_index,
      case when x.selected_index is null then null
        else (v_s.option_orders->x.question_id::text->>x.selected_index)::int end original_selected
    from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean)
  ),a as (
    select q.area,count(*) total,
      count(*) filter(where s.selected_index is not null) answered,
      count(*) filter(where s.selected_index is not null and s.original_selected=q.correct_option) correct
    from s join public.questions q on q.id=s.question_id and q.program=v_s.program group by q.area
  )
  select coalesce(jsonb_object_agg(area,jsonb_build_object('total',total,'answered',answered,'correct',correct)),'{}'::jsonb)
  into v_by_area from a;

  with s as (
    select x.question_id,x.selected_index,
      case when x.selected_index is null then null
        else (v_s.option_orders->x.question_id::text->>x.selected_index)::int end original_selected
    from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean)
  )
  select coalesce(jsonb_agg(q.id order by q.id)
    filter(where s.selected_index is not null and s.original_selected<>q.correct_option),'[]'::jsonb)
  into v_wrong_ids
  from s join public.questions q on q.id=s.question_id and q.program=v_s.program;

  insert into public.attempts(
    user_id,mode,started_at,finished_at,score,total_questions,metadata,session_id
  ) values(
    v_uid,v_s.mode,v_s.created_at,v_now,v_score,v_total,
    jsonb_build_object(
      'program',v_s.program,'correct',v_correct,'wrong',v_wrong,
      'answered',v_answered,'unanswered',v_total-v_answered,
      'byArea',v_by_area,'wrongIds',v_wrong_ids,'appVersion','6.0-release'
    ),v_s.id
  )
  on conflict(session_id) where session_id is not null
  do update set session_id=excluded.session_id
  returning id into v_attempt_id;

  insert into public.attempt_answers(
    attempt_id,question_id,selected_option,is_correct,is_flagged,answered_at
  )
  select v_attempt_id,q.id,s.original_selected,
    case when s.original_selected is null then null else s.original_selected=q.correct_option end,
    coalesce(s.is_flagged,false),v_now
  from (
    select x.question_id,x.selected_index,x.is_flagged,
      case when x.selected_index is null then null
        else (v_s.option_orders->x.question_id::text->>x.selected_index)::int end original_selected
    from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean)
  ) s
  join public.questions q on q.id=s.question_id and q.program=v_s.program;

  update public.exam_sessions
  set submitted_at=v_now,attempt_id=v_attempt_id,answers=p_answers,updated_at=v_now
  where id=v_s.id;

  if v_s.mode='trial' then
    insert into public.trial_entitlements(user_id,program,first_session_id,consumed_at,created_at,updated_at)
    values(v_uid,v_s.program,v_s.id,v_now,now(),now())
    on conflict(user_id,program) do update
      set first_session_id=coalesce(public.trial_entitlements.first_session_id,excluded.first_session_id),
          consumed_at=coalesce(public.trial_entitlements.consumed_at,excluded.consumed_at),
          updated_at=now();
  end if;

  return public._attempt_payload(v_attempt_id,v_uid);
end
$function$;
