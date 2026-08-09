CREATE SCHEMA test_schema;

-- Same window function and signature TYPES, but the parameter is renamed
-- (x -> y). CREATE OR REPLACE cannot rename a parameter, so the engine must
-- drop+recreate my_lag (a "replace"). The view below is byte-identical to side a
-- (the call does not name the parameter), so it is only rebuilt if the
-- view -> my_lag dependency edge exists.
CREATE FUNCTION test_schema.my_lag(y anyelement) RETURNS anyelement
  LANGUAGE internal WINDOW AS 'window_lag';

CREATE TABLE test_schema.events (
  id int,
  val int
);

CREATE VIEW test_schema.lagged AS
  SELECT id, test_schema.my_lag(val) OVER (ORDER BY id) AS prev_val
  FROM test_schema.events;
