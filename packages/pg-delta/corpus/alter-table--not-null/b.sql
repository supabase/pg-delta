-- name gains NOT NULL; email drops NOT NULL
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer NOT NULL,
  name text NOT NULL,
  email text
);
