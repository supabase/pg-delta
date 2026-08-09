CREATE PUBLICATION corpus_sub_drop_pub FOR ALL TABLES;
CREATE SUBSCRIPTION corpus_sub_drop
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_sub_drop_pub
  WITH (connect = false, slot_name = NONE, enabled = false);
