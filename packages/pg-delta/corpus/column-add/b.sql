CREATE SCHEMA app;
CREATE TABLE app.users (
  id integer PRIMARY KEY,
  email text NOT NULL DEFAULT 'unknown@example.com',
  bio text
);
