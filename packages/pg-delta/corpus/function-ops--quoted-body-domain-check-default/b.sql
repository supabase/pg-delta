-- `ADD COLUMN val app.checked_text DEFAULT 'ok'` on a POPULATED table coerces the
-- default into the domain, which RUNS the domain's CHECK — so the column create
-- is an execution-time statement that executes app.wrapper() and, through its
-- opaque PL/pgSQL body, app.z_helper().
--
-- A domain's CHECK constraints are CHILD facts (kind `constraint`, parent kind
-- `domain`), NOT outgoing edges of the domain fact. The column's only recorded
-- dependency is `column -> domain`, so a reachability walk that follows edges
-- alone finds no routine, leaves the column in the definition stratum, and its
-- weight (5) beats the new helper's routine weight (8).
CREATE SCHEMA app;

CREATE FUNCTION app.z_helper(v text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT length(v) > 0$function$;

CREATE FUNCTION app.wrapper(v text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN app.z_helper(v);
END;
$function$;

CREATE DOMAIN app.checked_text AS text
  CONSTRAINT checked_text_ok CHECK (app.wrapper(VALUE));

CREATE TABLE app.entries (
  id bigint PRIMARY KEY,
  val app.checked_text DEFAULT 'ok'
);
