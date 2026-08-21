create extension if not exists pgcrypto;

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null unique,
  whatsapp_number text not null unique,
  business_name text not null,
  status text not null default 'onboarding' check (status in ('onboarding', 'active', 'suspended')),
  trust_score numeric not null default 0,
  payout_details jsonb,
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null unique,
  merchant_id uuid not null references public.merchants(id),
  title text not null,
  description text not null default '',
  price_cents integer not null check (price_cents > 0),
  photo_url text,
  status text not null default 'active' check (status in ('active', 'sold', 'inactive')),
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,
  listing_id uuid not null references public.listings(id),
  merchant_id uuid not null references public.merchants(id),
  buyer_whatsapp_number text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'awaiting_fulfilment', 'awaiting_buyer_confirmation', 'released', 'disputed', 'refunded', 'cancelled')),
  payfast_payment_id text,
  payfast_pf_payment_id text,
  seller_evidence_url text,
  buyer_evidence_url text,
  ai_match_confidence numeric check (ai_match_confidence between 0 and 1),
  ai_match_notes text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  released_at timestamptz
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  whatsapp_number text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  merchant_id uuid references public.merchants(id),
  transaction_id uuid references public.transactions(id),
  message_type text not null check (message_type in ('text', 'image', 'system')),
  body text,
  media_url text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved_refund', 'resolved_release')),
  admin_notes text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index listings_merchant_id_idx on public.listings(merchant_id);
create index transactions_merchant_id_idx on public.transactions(merchant_id);
create index transactions_buyer_number_idx on public.transactions(buyer_whatsapp_number);
create index messages_transaction_id_idx on public.messages(transaction_id);
create index disputes_status_idx on public.disputes(status);

alter table public.merchants enable row level security;
alter table public.listings enable row level security;
alter table public.transactions enable row level security;
alter table public.messages enable row level security;
alter table public.disputes enable row level security;
alter table public.app_settings enable row level security;

insert into storage.buckets (id, name, public) values ('abbypay-media', 'abbypay-media', true)
on conflict (id) do nothing;