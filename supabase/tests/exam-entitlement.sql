BEGIN;

CREATE TEMP TABLE audit_results(test text, passed boolean);
DO $audit$
DECLARE uid uuid:=gen_random_uuid(); other_uid uuid:=gen_random_uuid(); sid uuid; ids bigint[]; orders jsonb; ans jsonb; result jsonb; before_answers jsonb; mode_name text; state_name text; op text; blocked boolean; err text; cnt int;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,uid::text||'@audit.invalid','{}'),(other_uid,other_uid::text||'@audit.invalid','{}');
 UPDATE public.profiles SET program='ners',role='student' WHERE id IN(uid,other_uid);
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 FOREACH mode_name IN ARRAY ARRAY['learn','wrong','tryout'] LOOP
  SELECT array_agg(id),jsonb_object_agg(id::text,'[0,1,2,3,4]'::jsonb),jsonb_agg(jsonb_build_object('question_id',id,'selected_index',null,'is_flagged',false))
  INTO ids,orders,ans FROM (SELECT id FROM public.questions WHERE program='ners' AND is_active ORDER BY id LIMIT CASE WHEN mode_name='tryout' THEN 180 ELSE 1 END)q;
  FOREACH state_name IN ARRAY ARRAY['absent','expired','suspended','other_program'] LOOP
   DELETE FROM public.subscriptions WHERE user_id=uid;
   IF state_name<>'absent' THEN
    INSERT INTO public.subscriptions(user_id,program,status,expires_at) VALUES(uid,CASE WHEN state_name='other_program' THEN 'd3' ELSE 'ners' END,CASE WHEN state_name='suspended' THEN 'inactive' ELSE 'active' END,CASE WHEN state_name='expired' THEN now()-interval '1 second' ELSE now()+interval '1 day' END);
   END IF;
   INSERT INTO public.exam_sessions(user_id,program,mode,question_ids,option_orders,expected_count,expires_at) VALUES(uid,'ners',mode_name,ids,orders,cardinality(ids),now()+interval '1 hour') RETURNING id INTO sid;
   FOREACH op IN ARRAY ARRAY['resume','save','submit','start_trial'] LOOP
    blocked:=false;err:=null;
    BEGIN
     CASE op
      WHEN 'resume' THEN result:=public.resume_exam_session();
      WHEN 'save' THEN result:=public.save_exam_progress(sid,ans);
      WHEN 'submit' THEN result:=public.submit_exam_session(sid,ans);
      WHEN 'start_trial' THEN result:=public.start_exam_session(p_mode=>'trial',p_limit=>10,p_area=>null,p_ids=>null,p_randomize=>true);
     END CASE;
    EXCEPTION WHEN OTHERS THEN err:=SQLERRM;blocked:=err='PREMIUM_REQUIRED'; END;
    INSERT INTO audit_results VALUES(mode_name||'/'||state_name||'/'||op,blocked);
   END LOOP;
   INSERT INTO audit_results SELECT mode_name||'/'||state_name||'/unchanged',answers='[]'::jsonb AND attempt_id IS NULL AND submitted_at IS NULL AND cancelled_at IS NULL FROM public.exam_sessions WHERE id=sid;
   DELETE FROM public.trial_entitlements WHERE user_id=uid;
   DELETE FROM public.exam_sessions WHERE id=sid;
  END LOOP;
 END LOOP;
 DELETE FROM public.subscriptions WHERE user_id=uid;
 -- Valid, unlimited and admin controls, followed by completed retries after expiry.
 FOREACH state_name IN ARRAY ARRAY['active','unlimited','admin'] LOOP
  DELETE FROM public.subscriptions WHERE user_id=uid;
  UPDATE public.profiles SET role=CASE WHEN state_name='admin' THEN 'super_admin' ELSE 'student' END WHERE id=uid;
  IF state_name<>'admin' THEN INSERT INTO public.subscriptions(user_id,program,status,expires_at) VALUES(uid,'ners','active',CASE WHEN state_name='unlimited' THEN null ELSE now()+interval '1 day' END); END IF;
  SELECT ARRAY[id],jsonb_build_object(id::text,'[0,1,2,3,4]'::jsonb),jsonb_build_array(jsonb_build_object('question_id',id,'selected_index',0,'is_flagged',true)) INTO ids,orders,ans FROM public.questions WHERE program='ners' AND is_active ORDER BY id LIMIT 1;
  INSERT INTO public.exam_sessions(user_id,program,mode,question_ids,option_orders,expected_count,expires_at) VALUES(uid,'ners','learn',ids,orders,1,now()+interval '1 hour') RETURNING id INTO sid;
  result:=public.resume_exam_session();INSERT INTO audit_results VALUES(state_name||'/resume',result->>'session_id'=sid::text);
  result:=public.save_exam_progress(sid,ans);INSERT INTO audit_results VALUES(state_name||'/save',(result->>'ok')::boolean);
  result:=public.submit_exam_session(sid,ans);INSERT INTO audit_results VALUES(state_name||'/submit',result->>'session_id'=sid::text AND jsonb_array_length(result->'review')=1);
  UPDATE public.profiles SET role='student' WHERE id=uid;DELETE FROM public.subscriptions WHERE user_id=uid;
  result:=public.submit_exam_session(sid,ans);INSERT INTO audit_results VALUES(state_name||'/completed_submit_retry',result->>'session_id'=sid::text);
  result:=public.save_exam_progress(sid,ans);INSERT INTO audit_results VALUES(state_name||'/completed_save_retry',(result->>'submitted')::boolean);
  result:=public.get_attempt_review((SELECT attempt_id FROM public.exam_sessions WHERE id=sid));INSERT INTO audit_results VALUES(state_name||'/history_after_expiry',jsonb_array_length(result->'review')=1);
 END LOOP;
 FOREACH cnt IN ARRAY ARRAY[10,20] LOOP
  SELECT array_agg(id),jsonb_object_agg(id::text,'[0,1,2,3,4]'::jsonb),jsonb_agg(jsonb_build_object('question_id',id,'selected_index',null,'is_flagged',false))
  INTO ids,orders,ans FROM (SELECT id FROM public.questions WHERE program='ners' AND is_active ORDER BY id LIMIT cnt)q;
  INSERT INTO public.exam_sessions(user_id,program,mode,question_ids,option_orders,expected_count,expires_at) VALUES(uid,'ners','trial',ids,orders,cnt,now()-interval '1 day') RETURNING id INTO sid;
  result:=public.resume_exam_session();INSERT INTO audit_results VALUES('trial'||cnt||'/resume',jsonb_array_length(result->'questions')=cnt);
  result:=public.save_exam_progress(sid,ans);INSERT INTO audit_results VALUES('trial'||cnt||'/save',(result->>'ok')::boolean);
  result:=public.submit_exam_session(sid,ans);INSERT INTO audit_results VALUES('trial'||cnt||'/submit',jsonb_array_length(result->'review')=cnt);
 END LOOP;
 -- Ownership gates, anonymous RPCs.
 FOREACH op IN ARRAY ARRAY['save','submit'] LOOP
  PERFORM set_config('request.jwt.claim.sub',other_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_uid,'role','authenticated')::text,true);
  blocked:=false;
  BEGIN
   IF op='save' THEN result:=public.save_exam_progress(sid,ans);ELSE result:=public.submit_exam_session(sid,ans);END IF;
  EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM='SESSION_NOT_FOUND';END;
  INSERT INTO audit_results VALUES('foreign_session/'||op,blocked);
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{}',true);
 blocked:=false;BEGIN result:=public.resume_exam_session();EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM='AUTH_REQUIRED';END;
 INSERT INTO audit_results VALUES('anonymous/resume',blocked);
END $audit$;
SELECT count(*) total,count(*) FILTER(WHERE passed) passed,jsonb_agg(test) FILTER(WHERE NOT passed) failed_tests FROM audit_results;

ROLLBACK;
