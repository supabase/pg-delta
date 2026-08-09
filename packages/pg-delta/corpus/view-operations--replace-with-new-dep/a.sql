CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text,
  status text
);

CREATE TABLE test_schema.profiles (
  user_id integer,
  bio text,
  avatar_url text
);

CREATE VIEW test_schema.user_summary AS
SELECT id, name, status
FROM test_schema.users;
