CREATE OR REPLACE FUNCTION public.get_my_access()
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
  v_trial_used boolean:=false;
  v_exp timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select p.program,coalesce(p.role,'student')
  into v_program,v_role
  from public.profiles p
  where p.id=v_uid;

  if v_program is null then
    return jsonb_build_object('profile_complete',false);
  end if;

  select max(s.expires_at)
  into v_exp
  from public.subscriptions s
  where s.user_id=v_uid
    and s.program=v_program
    and s.status='active'
    and (s.expires_at is null or s.expires_at>now());

  v_premium := (v_role='super_admin') or exists (
    select 1 from public.subscriptions s where s.user_id=v_uid and s.program=v_program
      and s.status='active' and (s.expires_at is null or s.expires_at>now())
  );

  select exists(
    select 1 from public.trial_entitlements te
    where te.user_id=v_uid
      and te.program=v_program
      and te.consumed_at is not null
  ) into v_trial_used;

  return jsonb_build_object(
    'profile_complete',true,
    'program',v_program,
    'role',v_role,
    'premium',v_premium,
    'expires_at',v_exp,
    'trial_used',v_trial_used,
    'promo_price',40000,
    'normal_price',150000
  );
end
$function$
;
