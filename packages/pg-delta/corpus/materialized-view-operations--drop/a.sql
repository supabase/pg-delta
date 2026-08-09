CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text NOT NULL,
  active boolean DEFAULT true
);

CREATE MATERIALIZED VIEW test_schema.active_users AS
SELECT id, name
FROM test_schema.users
WHERE active = true
WITH NO DATA;
