create unique index messages_zernio_event_id_idx
  on public.messages ((raw_payload ->> 'id'))
  where direction = 'inbound' and raw_payload ? 'id';