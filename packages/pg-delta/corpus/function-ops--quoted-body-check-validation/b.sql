-- A VALIDATED CHECK constraint SCANS the existing rows while it is added, so it
-- RUNS app.is_valid_code() — whose quoted SQL body calls app.z_valid_codes(),
-- an unrecorded hop.
--
-- The helper is deliberately BLOCKED behind a view (`RETURNS SETOF
-- app.valid_codes` is a real pg_depend edge), so it cannot be created until the
-- view is. Constraints (weight 10) tie-break ahead of views (12), so without an
-- evaluator stratum the ADD CONSTRAINT overtakes both and the validation scan
-- calls a routine that does not exist yet.
CREATE SCHEMA app;

CREATE TABLE app.events (
  id bigint PRIMARY KEY,
  code text NOT NULL
);

CREATE VIEW app.valid_codes AS SELECT 'ok'::text AS code;

CREATE FUNCTION app.z_valid_codes()
 RETURNS SETOF app.valid_codes
 LANGUAGE sql
 STABLE
AS $function$SELECT * FROM app.valid_codes$function$;

CREATE FUNCTION app.is_valid_code(candidate text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$SELECT EXISTS (SELECT 1 FROM app.z_valid_codes() vc WHERE vc.code = candidate)$function$;

ALTER TABLE app.events
  ADD CONSTRAINT events_code_valid CHECK (app.is_valid_code(code));
