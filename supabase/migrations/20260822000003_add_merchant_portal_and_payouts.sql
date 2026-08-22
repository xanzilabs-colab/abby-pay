alter table public.merchants
  add column if not exists portal_email text unique,
  add column if not exists payout_pin_hash text,
  add column if not exists payout_pin_failed_attempts integer not null default 0,
  add column if not exists payout_pin_locked_until timestamptz,
  add column if not exists payout_details_updated_at timestamptz;

create table if not exists public.merchant_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  transaction_id uuid references public.transactions(id),
  entry_type text not null check (entry_type in ('release', 'payout_request', 'payout_reversal')),
  amount_cents integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending_review' check (status in ('pending_review', 'processing', 'paid', 'rejected', 'cancelled')),
  payout_snapshot jsonb not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by text,
  notes text
);

create index if not exists merchant_ledger_entries_merchant_idx on public.merchant_ledger_entries(merchant_id, created_at desc);
create index if not exists payout_requests_merchant_idx on public.payout_requests(merchant_id, requested_at desc);
create unique index if not exists merchant_ledger_release_transaction_idx on public.merchant_ledger_entries(transaction_id, entry_type) where transaction_id is not null;

alter table public.merchant_ledger_entries enable row level security;
alter table public.payout_requests enable row level security;