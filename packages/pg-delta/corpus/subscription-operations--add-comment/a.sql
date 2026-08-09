CREATE PUBLICATION corpus_sub_comment_pub FOR ALL TABLES;
CREATE SUBSCRIPTION corpus_sub_comment
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_sub_comment_pub
  WITH (connect = false, slot_name = NONE, enabled = false);
