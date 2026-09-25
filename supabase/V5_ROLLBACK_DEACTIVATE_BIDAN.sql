-- UKOM Health Pro V5 emergency rollback: immediately hide all Profesi Bidan questions.
-- This does not delete questions, attempts, users, payments, or subscriptions.

update public.questions
set is_active=false, updated_at=now()
where program='bidan';

select program,count(*) as active_questions
from public.questions
where program='bidan' and is_active
group by program;
