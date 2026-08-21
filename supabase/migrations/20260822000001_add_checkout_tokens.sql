alter table public.transactions
  add column if not exists checkout_token uuid;

update public.transactions
  set checkout_token = gen_random_uuid()
  where checkout_token is null;

alter table public.transactions
  alter column checkout_token set default gen_random_uuid(),
  alter column checkout_token set not null;

create unique index if not exists transactions_checkout_token_idx
  on public.transactions(checkout_token);