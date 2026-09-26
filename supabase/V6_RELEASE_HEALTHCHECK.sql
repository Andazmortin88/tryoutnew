-- UKOM Health Pro V6 release health check (read-only)
-- Run in Supabase SQL Editor. No data is modified.

select program,
       count(*) as total,
       count(*) filter(where is_active) as active,
       count(*) filter(where review_status='reviewed') as reviewed,
       count(*) filter(where correct_option=0) as key_a,
       count(*) filter(where correct_option=1) as key_b,
       count(*) filter(where correct_option=2) as key_c,
       count(*) filter(where correct_option=3) as key_d,
       count(*) filter(where correct_option=4) as key_e,
       count(*) filter(where coalesce(trim(explanation),'')='') as missing_explanation,
       count(*) filter(where coalesce(trim(reference_text),'')='') as missing_reference
from public.questions
group by program
order by program;

select
  has_function_privilege('authenticated','public.get_exam_questions(integer,text,bigint[],text)','execute') as legacy_get_exam_enabled,
  has_function_privilege('authenticated','public.submit_ukom_attempt(text,timestamptz,jsonb)','execute') as legacy_submit_enabled,
  has_function_privilege('authenticated','public.start_exam_session(text,integer,text,bigint[],boolean)','execute') as start_exam_enabled,
  has_function_privilege('authenticated','public.save_exam_progress(uuid,jsonb)','execute') as save_progress_enabled,
  has_function_privilege('authenticated','public.resume_exam_session()','execute') as resume_enabled,
  has_function_privilege('authenticated','public.submit_exam_session(uuid,jsonb)','execute') as submit_exam_enabled,
  has_function_privilege('authenticated','public.get_attempt_review(uuid)','execute') as review_enabled,
  has_table_privilege('authenticated','public.transactions','select') as browser_transactions_select,
  has_table_privilege('authenticated','public.subscriptions','select') as browser_subscriptions_select;

select
  count(*) filter(where submitted_at is null and cancelled_at is null and expires_at>now()) as active_exam_sessions,
  count(*) filter(where mode='tryout' and submitted_at is null and cancelled_at is null and expires_at<=now()) as expired_unclosed_tryouts
from public.exam_sessions;

select
  count(*) filter(where status='failed') as email_failed,
  count(*) filter(where status='pending' and created_at<now()-interval '15 minutes') as email_stale_pending,
  count(*) filter(where lease_until is not null and lease_until<now() and status='pending') as email_expired_leases
from public.payment_email_outbox;

select
  count(*) filter(where transaction_status='pending' and created_at<now()-interval '1 day') as old_pending_transactions,
  count(*) filter(where payment_review_required is true) as payment_review_required
from public.transactions;

select
  (select count(*) from public.questions_release_candidate_20260926) as release_snapshot_rows,
  (select count(*) from public.questions) as current_question_rows;
