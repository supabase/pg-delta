CREATE SCHEMA test_schema;

CREATE TABLE test_schema.foo (id integer PRIMARY KEY);

CREATE FUNCTION test_schema.bar()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NULL;
END;
$$;

CREATE TRIGGER foo_insert
  BEFORE INSERT ON test_schema.foo
  FOR EACH ROW
  EXECUTE FUNCTION test_schema.bar();
