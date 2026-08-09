DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_sub_owner') THEN
    CREATE ROLE corpus_sub_owner SUPERUSER;
  END IF;
END $$;
CREATE PUBLICATION corpus_sub_alter_pub FOR ALL TABLES;
CREATE PUBLICATION corpus_sub_alter_pub2 FOR ALL TABLES;
-- Subscription with altered connection string, publication list, and options.
-- The b-state represents the final desired configuration after all ALTER steps.
CREATE SUBSCRIPTION corpus_sub_alter
  CONNECTION 'host=localhost dbname=postgres application_name=corpus_sub_alter'
  PUBLICATION corpus_sub_alter_pub, corpus_sub_alter_pub2
  WITH (
    connect = false,
    slot_name = 'corpus_sub_alter_slot',
    enabled = false,
    binary = true,
    synchronous_commit = 'local',
    disable_on_error = true
  );
COMMENT ON SUBSCRIPTION corpus_sub_alter IS 'subscription metadata';
ALTER SUBSCRIPTION corpus_sub_alter OWNER TO corpus_sub_owner;
