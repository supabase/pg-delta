DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_sub_owner') THEN
    CREATE ROLE corpus_sub_owner SUPERUSER;
  END IF;
END $$;
CREATE PUBLICATION corpus_sub_alter_pub FOR ALL TABLES;
CREATE PUBLICATION corpus_sub_alter_pub2 FOR ALL TABLES;
CREATE SUBSCRIPTION corpus_sub_alter
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_sub_alter_pub
  WITH (connect = false, slot_name = NONE, enabled = false);
