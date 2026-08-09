DO $$ BEGIN CREATE ROLE corpus_ddl_owner SUPERUSER NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.log_ddl()
RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'DDL event %', TG_TAG;
END;
$$;

CREATE EVENT TRIGGER ddl_logger
  ON ddl_command_start
  EXECUTE FUNCTION test_schema.log_ddl();
