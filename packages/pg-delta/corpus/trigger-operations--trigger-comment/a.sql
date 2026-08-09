CREATE SCHEMA test_schema;

CREATE TABLE test_schema.logs (
  id serial PRIMARY KEY,
  msg text,
  created_at timestamp DEFAULT now()
);

CREATE FUNCTION test_schema.log_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER logs_insert_trigger
  BEFORE INSERT ON test_schema.logs
  FOR EACH ROW
  EXECUTE FUNCTION test_schema.log_insert();
