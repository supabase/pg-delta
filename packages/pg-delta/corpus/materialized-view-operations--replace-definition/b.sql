CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text,
  active boolean DEFAULT true
);

CREATE MATERIALIZED VIEW test_schema.user_summary AS
SELECT id, name, email
FROM test_schema.users
WHERE active = true
ORDER BY name
WITH NO DATA;
