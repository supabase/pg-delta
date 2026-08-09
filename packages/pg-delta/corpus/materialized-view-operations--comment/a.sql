CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text
);

CREATE MATERIALIZED VIEW test_schema.user_names AS
  SELECT id, name FROM test_schema.users WITH NO DATA;
