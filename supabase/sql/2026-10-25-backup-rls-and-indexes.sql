ALTER TABLE public.questions_bidan_backup_20260926 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions_prelaunch_audit_backup_20260926 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions_d3_backup_20260926 ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_gerontik_activity_user ON public.gerontik_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_gerontik_reminders_from_user ON public.gerontik_peer_reminders(from_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_email_user ON public.payment_email_outbox(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_owner_user ON public.payment_owner_notifications(user_id);
