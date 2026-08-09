CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.log_ddl_dependency()
RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'dependency %', TG_TAG;
END;
$$;

CREATE EVENT TRIGGER ddl_logger_dependency
  ON ddl_command_start
  EXECUTE FUNCTION test_schema.log_ddl_dependency();
