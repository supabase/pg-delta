CREATE SCHEMA test_schema;

CREATE TABLE test_schema.foo (id integer PRIMARY KEY);

CREATE TABLE test_schema.bar (id integer PRIMARY KEY);

CREATE FUNCTION test_schema.shared_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER foo_insert
BEFORE INSERT ON test_schema.foo
FOR EACH ROW
EXECUTE FUNCTION test_schema.shared_trigger_fn();

CREATE TRIGGER bar_insert
BEFORE INSERT ON test_schema.bar
FOR EACH ROW
EXECUTE FUNCTION test_schema.shared_trigger_fn();
