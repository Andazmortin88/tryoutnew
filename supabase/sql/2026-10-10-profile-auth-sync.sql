-- One profile per Auth account. Login reads persisted data, never a local-only profile.
begin;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,full_name,email,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',''),new.email,'student')
  on conflict(id) do update set email=excluded.email
  where profiles.email is distinct from excluded.email;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function app_private.sync_auth_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email=new.email
  where id=new.id and email is distinct from new.email;
  return new;
end;
$$;
revoke all on function app_private.sync_auth_profile_email() from public,anon,authenticated;
drop trigger if exists sync_profile_after_auth_email_change on auth.users;
create trigger sync_profile_after_auth_email_change after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function app_private.sync_auth_profile_email();

-- Definer is needed to repair a missing row: client roles cannot write profiles directly.
-- Identity comes only from auth.uid(); no caller-supplied ID, email, role or program.
create or replace function public.sync_my_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_user auth.users%rowtype;
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_user from auth.users where id=v_uid;
  if not found then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.profiles(id,full_name,email,role)
  values(v_uid,coalesce(v_user.raw_user_meta_data->>'full_name',v_user.raw_user_meta_data->>'name',''),v_user.email,'student')
  on conflict(id) do update set email=excluded.email
  where profiles.email is distinct from excluded.email;
  select * into strict v_profile from public.profiles where id=v_uid;
  return to_jsonb(v_profile);
end;
$$;
revoke all on function public.sync_my_profile() from public,anon;
grant execute on function public.sync_my_profile() to authenticated;

-- Reconcile existing data without replacing names, programs, institutions or roles.
insert into public.profiles(id,full_name,email,role,created_at)
select id,coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name',''),email,'student',created_at
from auth.users
on conflict(id) do update set email=excluded.email
where profiles.email is distinct from excluded.email;
commit;
