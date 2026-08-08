CREATE SCHEMA app;

CREATE TABLE app.source_rows (
  id bigint PRIMARY KEY,
  code text NOT NULL
);
