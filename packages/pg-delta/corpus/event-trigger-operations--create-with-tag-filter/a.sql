CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.log_ddl()
RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'DDL event %', TG_TAG;
END;
$$;
