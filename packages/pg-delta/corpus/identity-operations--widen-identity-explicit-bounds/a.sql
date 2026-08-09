-- integer identity with the type's default bounds
CREATE SCHEMA app;

CREATE TABLE app.counters (
  id integer GENERATED ALWAYS AS IDENTITY,
  label text
);
