-- integer identity + integer STORED generated column (narrow state)
CREATE SCHEMA app;

-- widening this column moves BOTH the column type and the implicit identity
-- sequence's MAXVALUE, so `type` and `identity` change on the SAME column fact
CREATE TABLE app.counters (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text
);

-- the generation expression renders identically for integer and bigint, so only
-- `type` changes here: PostgreSQL rejects both DROP DEFAULT and a USING cast on
-- a generated column
CREATE TABLE app.measurements (
  reading integer,
  doubled integer GENERATED ALWAYS AS (reading * 2) STORED
);
