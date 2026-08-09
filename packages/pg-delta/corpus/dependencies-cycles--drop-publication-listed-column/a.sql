CREATE TABLE public.lab_results (
  id bigint PRIMARY KEY,
  flash_summary text
);
CREATE PUBLICATION cycle_repro_realtime
  FOR TABLE public.lab_results (id, flash_summary);
