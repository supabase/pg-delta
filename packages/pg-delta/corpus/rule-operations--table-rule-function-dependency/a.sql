CREATE SCHEMA test_schema;

CREATE TABLE test_schema.audit_log (
  id serial PRIMARY KEY,
  msg text
);

CREATE TABLE test_schema.events (
  id serial PRIMARY KEY,
  name text
);

CREATE FUNCTION test_schema.f1(text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT 'f1:' || $1 $$;

-- A user rule on a PLAIN TABLE (relkind 'r') whose action references f1.
-- pg_depend records rule -> f1. When f1 is forced to drop+recreate (a
-- return-type change is a "replace"), the rule is otherwise UNCHANGED, so it can
-- only be rebuilt around the function via the rule -> f1 dependency edge. If that
-- edge is dropped, DROP FUNCTION f1 fails because the rule still depends on it.
CREATE RULE log_insert AS
  ON INSERT TO test_schema.events
  DO ALSO INSERT INTO test_schema.audit_log (msg)
  VALUES (test_schema.f1(NEW.name));
