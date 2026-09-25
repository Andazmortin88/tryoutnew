-- UKOM Health Pro V5 controlled release: activate Profesi Bidan bank.
-- Run ONLY after frontend regression, payment smoke test, and release approval.

do $$
declare
  v_total integer;
  v_reviewed integer;
  v_min bigint;
  v_max bigint;
  v_a integer;
  v_b integer;
  v_c integer;
  v_d integer;
  v_e integer;
begin
  select count(*), count(*) filter(where review_status='reviewed'), min(id), max(id),
         count(*) filter(where correct_option=0),
         count(*) filter(where correct_option=1),
         count(*) filter(where correct_option=2),
         count(*) filter(where correct_option=3),
         count(*) filter(where correct_option=4)
  into v_total,v_reviewed,v_min,v_max,v_a,v_b,v_c,v_d,v_e
  from public.questions
  where program='bidan';

  if v_total <> 180 then raise exception 'BIDAN_RELEASE_BLOCKED_TOTAL_%', v_total; end if;
  if v_reviewed <> 180 then raise exception 'BIDAN_RELEASE_BLOCKED_REVIEWED_%', v_reviewed; end if;
  if v_min <> 2001 or v_max <> 2180 then raise exception 'BIDAN_RELEASE_BLOCKED_ID_RANGE_%_%', v_min,v_max; end if;
  if v_a<>36 or v_b<>36 or v_c<>36 or v_d<>36 or v_e<>36 then
    raise exception 'BIDAN_RELEASE_BLOCKED_KEY_DISTRIBUTION_A%_B%_C%_D%_E%',v_a,v_b,v_c,v_d,v_e;
  end if;

  update public.questions
  set is_active=true, updated_at=now()
  where program='bidan'
    and review_status='reviewed'
    and id between 2001 and 2180;

  if (select count(*) from public.questions where program='bidan' and is_active) <> 180 then
    raise exception 'BIDAN_RELEASE_BLOCKED_ACTIVE_COUNT';
  end if;
end $$;

select program,count(*) as active_questions
from public.questions
where program='bidan' and is_active
group by program;
