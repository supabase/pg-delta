CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text NOT NULL,
  email text,
  created_at timestamp DEFAULT now()
);
