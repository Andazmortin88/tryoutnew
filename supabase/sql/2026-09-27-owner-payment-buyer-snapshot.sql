-- Keep the payer details used by the owner receipt fixed at payment time.
-- This table already has RLS enabled and is only accessible to the service role.
alter table public.payment_owner_notifications
  add column if not exists buyer_name text,
  add column if not exists buyer_institution text,
  add column if not exists buyer_email text;
