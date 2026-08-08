CREATE SCHEMA app;

CREATE TABLE app.events (
  id bigint PRIMARY KEY,
  code text NOT NULL
);
