-- Schema with a FK reference between two tables in a non-public schema.
-- Exercises ordering: schema must precede tables, referenced table must precede the FK constraint.
CREATE SCHEMA app;
CREATE TABLE app.users (
  id serial PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE app.posts (
  id serial PRIMARY KEY,
  user_id int REFERENCES app.users(id),
  title text NOT NULL
);
