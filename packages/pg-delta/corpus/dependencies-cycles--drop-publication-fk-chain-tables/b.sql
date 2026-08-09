CREATE TABLE public.labs (
  id bigint PRIMARY KEY,
  lab_id bigint NOT NULL
);
CREATE PUBLICATION supabase_realtime FOR TABLE public.labs;
