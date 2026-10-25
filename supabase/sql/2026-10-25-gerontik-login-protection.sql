CREATE TABLE IF NOT EXISTS public.gerontik_login_limits (
 bucket text PRIMARY KEY, window_started_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0
);
ALTER TABLE public.gerontik_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gerontik_login_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gerontik_login_limits TO service_role;
CREATE OR REPLACE FUNCTION public.gerontik_allow_login(p_account text,p_source text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE k text; cap integer; n integer; ok boolean:=true;
BEGIN
 IF length(p_account)>200 OR length(p_source)>200 THEN RETURN false; END IF;
 FOR k,cap IN SELECT 'account:'||encode(extensions.digest(lower(p_account),'sha256'),'hex'),10 UNION ALL SELECT 'source:'||encode(extensions.digest(p_source,'sha256'),'hex'),100 LOOP
  INSERT INTO public.gerontik_login_limits(bucket,window_started_at,attempts) VALUES(k,now(),1)
  ON CONFLICT(bucket) DO UPDATE SET
   attempts=CASE WHEN gerontik_login_limits.window_started_at<=now()-interval '5 minutes' THEN 1 ELSE least(gerontik_login_limits.attempts+1,10000) END,
   window_started_at=CASE WHEN gerontik_login_limits.window_started_at<=now()-interval '5 minutes' THEN now() ELSE gerontik_login_limits.window_started_at END
  RETURNING attempts INTO n;
  IF n>cap THEN ok:=false; END IF;
 END LOOP;
 RETURN ok;
END $fn$;
REVOKE ALL ON FUNCTION public.gerontik_allow_login(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerontik_allow_login(text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.gerontik_verify_admin_password(p_user uuid,p_password text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.gerontik_users u WHERE u.user_id=p_user AND u.active AND u.role IN ('ADMIN','INSTRUCTOR')
 AND u.password_hash LIKE '$2%' AND u.password_hash=extensions.crypt(p_password,u.password_hash));
$fn$;
REVOKE ALL ON FUNCTION public.gerontik_verify_admin_password(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gerontik_verify_admin_password(uuid,text) TO service_role;

