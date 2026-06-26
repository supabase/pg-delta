CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text
);

CREATE VIEW test_schema.user_names AS SELECT id, name FROM test_schema.users;

COMMENT ON VIEW test_schema.user_names IS 'users names view';
