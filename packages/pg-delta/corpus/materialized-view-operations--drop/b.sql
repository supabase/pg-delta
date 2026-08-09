CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text NOT NULL,
  active boolean DEFAULT true
);
