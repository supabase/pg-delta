CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text,
  active boolean DEFAULT true
);
