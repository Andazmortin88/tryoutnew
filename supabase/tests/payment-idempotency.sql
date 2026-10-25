BEGIN;CREATE TEMP TABLE payment_audit(test text,passed boolean);
DO $p$ DECLARE uid uuid:=gen_random_uuid();other_uid uuid:=gen_random_uuid();v_plan text;price int;days int;req uuid;reserved jsonb;r jsonb;exp1 timestamptz;oid text;blocked boolean;
BEGIN
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,uid::text||'@audit.invalid','{}'),(other_uid,other_uid::text||'@audit.invalid','{}');UPDATE public.profiles SET program='ners' WHERE id IN(uid,other_uid);
FOREACH v_plan IN ARRAY ARRAY['sprint_3','intensif_7','launch_30','promo_90'] LOOP
price:=CASE v_plan WHEN 'sprint_3' THEN 20000 WHEN 'intensif_7' THEN 29900 WHEN 'launch_30' THEN 40000 ELSE 79900 END;
days:=CASE v_plan WHEN 'sprint_3' THEN 3 WHEN 'intensif_7' THEN 7 WHEN 'launch_30' THEN 30 ELSE 90 END;
DELETE FROM public.subscriptions WHERE user_id=uid;req:=gen_random_uuid();
reserved:=public.reserve_checkout_order(uid,'ners',v_plan,req);oid:=reserved->>'order_id';INSERT INTO payment_audit VALUES(v_plan||'/price',(reserved->>'amount')::int=price);
r:=public.reserve_checkout_order(uid,'ners',v_plan,req);INSERT INTO payment_audit VALUES(v_plan||'/checkout_retry',r->>'order_id'=oid AND (r->>'reused')::boolean);
blocked:=false;BEGIN r:=public.reserve_checkout_order(other_uid,'ners',v_plan,req);EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM='CHECKOUT_REQUEST_OWNER_MISMATCH';END;INSERT INTO payment_audit VALUES(v_plan||'/checkout_idor',blocked);
r:=public.apply_paid_midtrans_transaction(oid,'settlement','qris','fixture-'||req,'{}');SELECT expires_at INTO exp1 FROM public.subscriptions WHERE user_id=uid AND program='ners';INSERT INTO payment_audit VALUES(v_plan||'/duration',exp1=now()+make_interval(days=>days));
r:=public.apply_paid_midtrans_transaction(oid,'settlement','qris','fixture-'||req,'{}');INSERT INTO payment_audit SELECT v_plan||'/replay_no_extension',expires_at=exp1 AND (r->>'idempotent')::boolean FROM public.subscriptions WHERE user_id=uid;
r:=public.apply_paid_midtrans_transaction(oid,'refund','qris','fixture-'||req,'{}');INSERT INTO payment_audit SELECT v_plan||'/refund',status='suspended' AND expires_at<=now() FROM public.subscriptions WHERE user_id=uid;
END LOOP;
INSERT INTO payment_audit VALUES('payment_rpc_not_authenticated',NOT has_function_privilege('authenticated','public.apply_paid_midtrans_transaction(text,text,text,text,jsonb)','execute'));
INSERT INTO payment_audit VALUES('checkout_rpc_not_authenticated',NOT has_function_privilege('authenticated','public.reserve_checkout_order(uuid,text,text,uuid)','execute'));
END $p$;
SELECT count(*) total,count(*) FILTER(WHERE passed) passed,jsonb_agg(test) FILTER(WHERE NOT passed) failed_tests FROM payment_audit;ROLLBACK;
