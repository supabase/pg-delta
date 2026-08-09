CREATE SCHEMA app;

CREATE TABLE app.documents (
  id bigint PRIMARY KEY,
  title text NOT NULL
);
