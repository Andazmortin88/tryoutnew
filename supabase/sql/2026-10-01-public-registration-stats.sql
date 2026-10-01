-- Public aggregate only. Individual profiles remain protected by their existing RLS policies.
begin;

create table if not exists public.registration_stats (
  id smallint primary key default 1 check (id = 1),
  total_registered integer not null default 0 check (total_registered >= 0),
  ners integer not null default 0 check (ners >= 0),
  d3 integer not null default 0 check (d3 >= 0),
  bidan integer not null default 0 check (bidan >= 0),
  apoteker integer not null default 0 check (apoteker >= 0),
  updated_at timestamptz not null default now()
);

alter table public.registration_stats enable row level security;
revoke all on public.registration_stats from public, anon, authenticated;
grant select on public.registration_stats to anon, authenticated;
create policy "Read only anonymous registration totals"
  on public.registration_stats for select to anon, authenticated using (id = 1);

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create function app_private.refresh_registration_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.registration_stats set
      total_registered = total_registered + 1,
      ners = ners + case when new.program = 'ners' then 1 else 0 end,
      d3 = d3 + case when new.program = 'd3' then 1 else 0 end,
      bidan = bidan + case when new.program = 'bidan' then 1 else 0 end,
      apoteker = apoteker + case when new.program = 'apoteker' then 1 else 0 end,
      updated_at = now() where id = 1;
    return new;
  elsif tg_op = 'DELETE' then
    update public.registration_stats set
      total_registered = total_registered - 1,
      ners = ners - case when old.program = 'ners' then 1 else 0 end,
      d3 = d3 - case when old.program = 'd3' then 1 else 0 end,
      bidan = bidan - case when old.program = 'bidan' then 1 else 0 end,
      apoteker = apoteker - case when old.program = 'apoteker' then 1 else 0 end,
      updated_at = now() where id = 1;
    return old;
  elsif old.program is distinct from new.program then
    update public.registration_stats set
      ners = ners + case when new.program = 'ners' then 1 else 0 end - case when old.program = 'ners' then 1 else 0 end,
      d3 = d3 + case when new.program = 'd3' then 1 else 0 end - case when old.program = 'd3' then 1 else 0 end,
      bidan = bidan + case when new.program = 'bidan' then 1 else 0 end - case when old.program = 'bidan' then 1 else 0 end,
      apoteker = apoteker + case when new.program = 'apoteker' then 1 else 0 end - case when old.program = 'apoteker' then 1 else 0 end,
      updated_at = now() where id = 1;
  end if;
  return new;
end;
$$;

revoke all on function app_private.refresh_registration_stats() from public, anon, authenticated;

-- Hold profile writes while seeding and attaching the trigger, so no change is missed.
lock table public.profiles in share row exclusive mode;
insert into public.registration_stats (id, total_registered, ners, d3, bidan, apoteker)
select 1, count(*)::int,
  count(*) filter (where program = 'ners')::int,
  count(*) filter (where program = 'd3')::int,
  count(*) filter (where program = 'bidan')::int,
  count(*) filter (where program = 'apoteker')::int
from public.profiles
on conflict (id) do update set
  total_registered = excluded.total_registered,
  ners = excluded.ners, d3 = excluded.d3,
  bidan = excluded.bidan, apoteker = excluded.apoteker,
  updated_at = now();

create trigger update_registration_stats_after_profile_change
after insert or delete or update of program on public.profiles
for each row execute function app_private.refresh_registration_stats();

commit;
