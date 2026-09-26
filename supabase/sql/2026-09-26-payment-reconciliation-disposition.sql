-- Deployed to production on 2026-09-26.
-- Settlement records remain in the financial ledger. Record owner-confirmed
-- test payments without giving access or sending delayed confirmations.
alter table public.transactions
  add column payment_resolution text,
  add column payment_resolution_note text,
  add column payment_reconciled_at timestamptz;
alter table public.transactions
  add constraint transactions_payment_resolution_check
  check (payment_resolution is null or payment_resolution = 'owner_test_no_entitlement');
