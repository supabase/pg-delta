-- `CREATE MATERIALIZED VIEW … AS <query>` is emitted WITHOUT `WITH NO DATA`, so
-- applying it RUNS the query — a matview create is an execution-time statement,
-- not a definition-time one.
--
-- app.a_eval's query calls app.wrapper() (a recorded pg_depend edge, via the
-- matview's _RETURN rewrite rule). wrapper's QUOTED SQL body then calls
-- app.z_helper(), which the catalog never records. z_helper is in turn BLOCKED
-- behind app.z_blocker (`RETURNS SETOF app.z_blocker` is a real edge), so it
-- cannot be created until that matview is.
--
-- Both matviews carry the same create weight (13), and `a_eval` sorts before
-- `z_blocker` by encoded subject id — so without an evaluator stratum the
-- populating matview runs first and its query calls a routine that does not
-- exist yet.
CREATE SCHEMA app;

CREATE TABLE app.source_rows (
  id bigint PRIMARY KEY,
  code text NOT NULL
);

CREATE MATERIALIZED VIEW app.z_blocker AS
  SELECT id, code FROM app.source_rows;

CREATE FUNCTION app.z_helper()
 RETURNS SETOF app.z_blocker
 LANGUAGE sql
 STABLE
AS $function$SELECT * FROM app.z_blocker$function$;

CREATE FUNCTION app.wrapper()
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$SELECT count(*) FROM app.z_helper()$function$;

CREATE MATERIALIZED VIEW app.a_eval AS
  SELECT app.wrapper() AS blocked_row_count;
