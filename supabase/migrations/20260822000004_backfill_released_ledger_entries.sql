insert into public.merchant_ledger_entries (merchant_id, transaction_id, entry_type, amount_cents, created_at)
select
  transactions.merchant_id,
  transactions.id,
  'release',
  transactions.amount_cents,
  coalesce(transactions.released_at, transactions.created_at)
from public.transactions as transactions
left join public.merchant_ledger_entries as ledger
  on ledger.transaction_id = transactions.id
  and ledger.entry_type = 'release'
where transactions.status = 'released'
  and ledger.id is null;