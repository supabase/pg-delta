CREATE SCHEMA test_schema;

CREATE TABLE test_schema.roles (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL,
  project_ids integer[] NOT NULL
);

CREATE FUNCTION test_schema.role_and_project_ids_belong_to_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.project_ids) project_id
  ) THEN
    -- no-op: keep this function lightweight for the test
    NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER role_and_project_ids_belong_to_org
AFTER INSERT OR UPDATE ON test_schema.roles
FOR EACH ROW
EXECUTE FUNCTION test_schema.role_and_project_ids_belong_to_org();
