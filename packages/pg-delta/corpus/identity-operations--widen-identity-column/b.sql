-- same shape widened to bigint (identity column and generated column)
CREATE SCHEMA app;

CREATE TABLE app.counters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text
);

CREATE TABLE app.measurements (
  reading integer,
  doubled bigint GENERATED ALWAYS AS (reading * 2) STORED
);
