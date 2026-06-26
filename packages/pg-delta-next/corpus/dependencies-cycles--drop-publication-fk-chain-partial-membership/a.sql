CREATE TABLE public.trades (
  id bigint PRIMARY KEY,
  trade_id bigint NOT NULL,
  CONSTRAINT trades_trade_id_key UNIQUE (trade_id)
);

CREATE TABLE public.trade_status_events (
  id bigint PRIMARY KEY,
  trade_id bigint NOT NULL,
  CONSTRAINT trade_status_events_trade_id_fkey
    FOREIGN KEY (trade_id)
    REFERENCES public.trades(trade_id)
);

CREATE TABLE public.public_offering_events (
  id bigint PRIMARY KEY,
  source_event_id bigint NOT NULL,
  CONSTRAINT public_offering_events_source_event_id_fkey
    FOREIGN KEY (source_event_id)
    REFERENCES public.trade_status_events(id)
);

-- trade_status_events is deliberately NOT in the publication.
CREATE PUBLICATION supabase_realtime
  FOR TABLE public.trades, public.public_offering_events;
