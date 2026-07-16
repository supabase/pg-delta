CREATE SCHEMA test_schema;

-- A user-defined WINDOW function (prokind 'w'). LANGUAGE internal WINDOW lets us
-- create one without a C compiler (superuser only) by aliasing a built-in.
CREATE FUNCTION test_schema.my_lag(x anyelement) RETURNS anyelement
  LANGUAGE internal WINDOW AS 'window_lag';

CREATE TABLE test_schema.events (
  id int,
  val int
);

-- A view whose query uses the window function OVER (...). This records a
-- pg_depend edge from the view's _RETURN rule to the window function. When the
-- function is forced to drop+recreate (an arg-name change is a "replace" that
-- CREATE OR REPLACE cannot express), the view is otherwise UNCHANGED, so it can
-- only be rebuilt around the function via the view -> my_lag dependency edge. If
-- that edge is dropped (window functions excluded from the resolver), DROP
-- FUNCTION my_lag fails because the view still depends on it.
CREATE VIEW test_schema.lagged AS
  SELECT id, test_schema.my_lag(val) OVER (ORDER BY id) AS prev_val
  FROM test_schema.events;
