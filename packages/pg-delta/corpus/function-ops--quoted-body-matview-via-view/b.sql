-- A matview's evaluated "expression" is a whole QUERY, so a routine it executes
-- need not be a DIRECT dependency: `app.a_eval` selects from the plain view
-- `app.bridge`, and its only recorded pg_depend edge is to that view. Populating
-- a_eval expands bridge and RUNS app.wrapper() anyway.
--
-- (`CREATE VIEW` itself evaluates nothing — bridge is a definition, and its edge
-- to wrapper is enough to order it. Only the matview populates.)
--
-- wrapper's QUOTED SQL body then calls app.z_helper(), which the catalog never
-- records, and z_helper is BLOCKED behind app.z_blocker (`RETURNS SETOF
-- app.z_blocker` is a real edge). Both matviews share create weight 13 and
-- `a_eval` sorts before `z_blocker` by encoded subject id, so a classifier that
-- only looks for a DIRECT routine edge leaves a_eval in the definition stratum
-- and the populate runs before z_helper exists.
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

CREATE VIEW app.bridge AS
  SELECT app.wrapper() AS blocked_row_count;

CREATE MATERIALIZED VIEW app.a_eval AS
  SELECT * FROM app.bridge;
