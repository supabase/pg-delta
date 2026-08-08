-- The domain AND its CHECK already exist here; only the helper that the CHECK's
-- wrapper opaquely calls, plus the column that uses the domain, are new in b.
--
-- Why the domain must PRE-EXIST: `CREATE DOMAIN` inlines its validated CHECKs
-- (rules/types.ts, via alsoProduces), so a from-scratch domain create already
-- produces the `constraint` fact and is classified an evaluator by its DIRECT
-- routine edge. The gap only shows when the domain is untouched and the COLUMN
-- is the evaluating action.
--
-- `app.wrapper` is PL/pgSQL on purpose: plpgsql bodies are not name-resolved at
-- CREATE FUNCTION time, so this fixture loads cleanly under the default
-- check_function_bodies even though `app.z_helper` does not exist yet — and
-- pg_depend never records an edge from wrapper to it.
CREATE SCHEMA app;

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
  id bigint PRIMARY KEY
);
