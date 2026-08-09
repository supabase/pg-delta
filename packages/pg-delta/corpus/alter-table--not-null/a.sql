-- name is nullable; email has NOT NULL
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer NOT NULL,
  name text,
  email text NOT NULL
);
