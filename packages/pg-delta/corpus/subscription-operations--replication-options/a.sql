CREATE PUBLICATION corpus_subopt_pub FOR ALL TABLES;
-- Defaults: binary=off, streaming=off, synchronous_commit=off,
-- disable_on_error=off, two_phase=off.
CREATE SUBSCRIPTION corpus_subopt
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_subopt_pub
  WITH (connect = false, slot_name = NONE, enabled = false);
