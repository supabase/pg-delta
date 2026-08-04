-- same column, now a bigint identity: `identity` (add) and `type` (widen) both
-- change on the SAME column fact
CREATE SCHEMA app;

CREATE TABLE app.counters (
  id bigint GENERATED ALWAYS AS IDENTITY,
  label text
);
