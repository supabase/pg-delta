-- state A: table exists owned by default (test superuser), no app_user role
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text
);
