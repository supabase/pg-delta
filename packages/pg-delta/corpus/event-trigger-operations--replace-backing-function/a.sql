CREATE SCHEMA ext;

CREATE FUNCTION ext.grant_access()
RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'v1';
END;
$$;

CREATE EVENT TRIGGER issue_access
  ON ddl_command_end
  EXECUTE FUNCTION ext.grant_access();
