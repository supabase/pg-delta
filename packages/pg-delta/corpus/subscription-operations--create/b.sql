CREATE PUBLICATION corpus_sub_create_pub FOR ALL TABLES;
CREATE SUBSCRIPTION corpus_sub_create
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_sub_create_pub
  WITH (connect = false, slot_name = NONE, enabled = false);
