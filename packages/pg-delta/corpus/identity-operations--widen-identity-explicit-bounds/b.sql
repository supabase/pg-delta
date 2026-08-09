-- bigint identity carrying an EXPLICIT MAXVALUE that does not fit an integer
-- sequence. The reverse (narrowing) direction is the interesting one: retyping
-- the column to integer while the sequence still declares MAXVALUE
-- 5000000000 fails ("MAXVALUE … is out of range for sequence data type
-- integer"), so the identity bounds must be set BEFORE the type change when
-- narrowing (and after it when widening).
CREATE SCHEMA app;

CREATE TABLE app.counters (
  id bigint GENERATED ALWAYS AS IDENTITY (MAXVALUE 5000000000),
  label text
);
