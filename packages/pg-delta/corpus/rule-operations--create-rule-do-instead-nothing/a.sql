CREATE SCHEMA test_schema;
CREATE TABLE test_schema.accounts (
  id serial PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0
);
