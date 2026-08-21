with duplicate_events as (
  select id,
    row_number() over (
      partition by raw_payload ->> 'id'
      order by created_at asc, id asc
    ) as delivery_order
  from public.messages
  where direction = 'inbound' and raw_payload ? 'id'
)
delete from public.messages
where id in (
  select id from duplicate_events where delivery_order > 1
);

create unique index messages_zernio_event_id_idx
  on public.messages ((raw_payload ->> 'id'))
  where direction = 'inbound' and raw_payload ? 'id';