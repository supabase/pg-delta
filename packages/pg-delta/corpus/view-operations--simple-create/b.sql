CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text,
  email text
);

CREATE VIEW test_schema.active_users AS
SELECT id, name, email
FROM test_schema.users
WHERE email IS NOT NULL;
