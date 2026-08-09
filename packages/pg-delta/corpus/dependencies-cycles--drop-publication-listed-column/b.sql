CREATE TABLE public.lab_results (
  id bigint PRIMARY KEY
);
CREATE PUBLICATION cycle_repro_realtime
  FOR TABLE public.lab_results (id);
