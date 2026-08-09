CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text
);

CREATE VIEW test_schema.alter_options WITH (security_invoker = TRUE) AS
  SELECT id, name FROM test_schema.users;

CREATE VIEW test_schema.reset_options AS
  SELECT id, name FROM test_schema.users;

CREATE VIEW test_schema.create_with_options WITH (security_invoker = TRUE) AS
  SELECT id, name FROM test_schema.users;
