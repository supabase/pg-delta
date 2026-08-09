CREATE PUBLICATION corpus_sub_dep_pub FOR ALL TABLES;
CREATE SUBSCRIPTION corpus_sub_dep
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_sub_dep_pub
  WITH (connect = false, slot_name = NONE, enabled = false);
COMMENT ON SUBSCRIPTION corpus_sub_dep IS 'dependency check';
