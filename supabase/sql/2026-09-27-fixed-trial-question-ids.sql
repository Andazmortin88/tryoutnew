-- Curated, server-enforced 20-question trial sets for Ners, D3 and Bidan.
-- Existing in-progress trial sessions retain their issued question IDs.
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
    v_limit:=20; v_expires:=now()+interval '365 days';
  elsif v_mode='tryout' then
    v_limit:=180; v_expires:=now()+interval '180 minutes';
    select count(*) into v_active_count
    from public.questions q where q.program=v_program and q.is_active;
    if v_active_count<180 then raise exception 'TRYOUT_REQUIRES_180_ACTIVE_QUESTIONS'; end if;
    p_area:=null; p_ids:=null;
  elsif v_mode='wrong' then
    if p_ids is null or cardinality(p_ids)=0 then raise exception 'WRONG_IDS_REQUIRED'; end if;
    v_limit:=least(cardinality(p_ids),180); v_expires:=now()+interval '24 hours';
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
        else array[]::bigint[] end);
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
  if v_mode='trial' and cardinality(v_ids)<>20 then raise exception 'TRIAL_REQUIRES_20_QUESTIONS'; end if;
  if v_mode='tryout' and cardinality(v_ids)<>180 then raise exception 'TRYOUT_REQUIRES_180_QUESTIONS'; end if;

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
$function$

