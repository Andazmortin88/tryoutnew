CREATE OR REPLACE FUNCTION public._assert_exam_entitlement(p_uid uuid,p_program text,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF p_uid IS NULL OR auth.uid() IS DISTINCT FROM p_uid THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode='trial' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_uid AND role='super_admin')
     AND NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id=p_uid AND program=p_program AND status='active' AND (expires_at IS NULL OR expires_at>now()))
  THEN RAISE EXCEPTION 'PREMIUM_REQUIRED'; END IF;
END
$function$;
REVOKE ALL ON FUNCTION public._assert_exam_entitlement(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._assert_exam_entitlement(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public._exam_session_payload(p_session_id uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s public.exam_sessions%rowtype;
  v_questions jsonb;
begin
  select * into v_s from public.exam_sessions where id=p_session_id and user_id=p_uid;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  perform public._assert_exam_entitlement(p_uid,v_s.program,v_s.mode);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',q.id,'area',q.area,'subtopic',q.subtopic,'vignette',q.vignette,
      'media_path',q.media_path,'stimulus_table',q.stimulus_table,
      'options',jsonb_build_array(
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(o.arr)[1]+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(o.arr)[2]+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(o.arr)[3]+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(o.arr)[4]+1],
        (array[q.option_a,q.option_b,q.option_c,q.option_d,q.option_e])[(o.arr)[5]+1]
      ),
      'difficulty',q.difficulty,'cognitive_level',q.cognitive_level,'blueprint_tag',q.blueprint_tag
    ) order by u.ord
  ),'[]'::jsonb)
  into v_questions
  from unnest(v_s.question_ids) with ordinality u(question_id,ord)
  join public.questions q on q.id=u.question_id and q.program=v_s.program and q.is_active=true
  cross join lateral (
    select coalesce(array_agg(x.val::int order by x.ord),array[0,1,2,3,4]) arr
    from jsonb_array_elements_text(coalesce(v_s.option_orders->(q.id::text),'[0,1,2,3,4]'::jsonb))
      with ordinality x(val,ord)
  ) o;

  return jsonb_build_object(
    'session_id',v_s.id,'program',v_s.program,'mode',v_s.mode,'area',v_s.area,
    'created_at',v_s.created_at,'expires_at',v_s.expires_at,'server_now',now(),
    'submitted_at',v_s.submitted_at,'question_count',cardinality(v_s.question_ids),
    'answers',coalesce(v_s.answers,'[]'::jsonb),'last_saved_at',v_s.last_saved_at,
    'questions',v_questions
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.save_exam_progress(p_session_id uuid, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_s public.exam_sessions%rowtype;
  v_count int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'array' then raise exception 'INVALID_ANSWERS_PAYLOAD'; end if;

  select * into v_s from public.exam_sessions
  where id=p_session_id and user_id=v_uid
  for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.submitted_at is not null then return jsonb_build_object('ok',true,'submitted',true); end if;
  if v_s.cancelled_at is not null then raise exception 'SESSION_CANCELLED'; end if;
  perform public._assert_exam_entitlement(v_uid,v_s.program,v_s.mode);

  select count(*) into v_count
  from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean);

  if v_count>v_s.expected_count then raise exception 'TOO_MANY_ANSWERS'; end if;
  if exists(
    select 1
    from jsonb_to_recordset(p_answers) x(question_id bigint,selected_index smallint,is_flagged boolean)
    where x.question_id is null
       or not(x.question_id=any(v_s.question_ids))
       or (x.selected_index is not null and (x.selected_index<0 or x.selected_index>4))
  ) then raise exception 'INVALID_PROGRESS_PAYLOAD'; end if;

  update public.exam_sessions
  set answers=p_answers,last_saved_at=now(),updated_at=now()
  where id=p_session_id;

  return jsonb_build_object('ok',true,'saved_at',now());
end
$function$;

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
  perform public._assert_exam_entitlement(v_uid,v_s.program,v_s.mode);
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

