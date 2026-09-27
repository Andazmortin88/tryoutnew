-- One private delivery record per Midtrans order whose subscription was activated.
create table if not exists public.payment_owner_notifications (
  transaction_id uuid primary key references public.transactions(id) on delete cascade,
  order_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  program text not null check (program in ('ners','d3','bidan')),
  amount integer not null check (amount > 0),
  recipient_email text not null,
  paid_at timestamptz not null,
  expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','setup_required')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.payment_owner_notifications enable row level security;
revoke all on public.payment_owner_notifications from public, anon, authenticated;
grant select, insert, update on public.payment_owner_notifications to service_role;
create index if not exists payment_owner_notifications_retry_idx
  on public.payment_owner_notifications(status,created_at)
  where status in ('pending','failed','setup_required');
