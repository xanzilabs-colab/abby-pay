alter table public.transactions
  add column if not exists fulfilment_method text check (fulfilment_method in ('handover', 'courier')),
  add column if not exists fulfilment_reference text,
  add column if not exists delivery_evidence_url text;