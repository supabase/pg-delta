CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id serial PRIMARY KEY,
  username varchar(50) NOT NULL
);

CREATE VIEW test_schema.active_users AS
  SELECT id, username FROM test_schema.users WHERE id > 0;
