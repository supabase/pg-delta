CREATE SCHEMA test_schema;

CREATE TABLE test_schema.audit_log (
  id serial PRIMARY KEY,
  msg text
);

CREATE TABLE test_schema.events (
  id serial PRIMARY KEY,
  name text
);

-- Same function, same signature and body, but the RETURN TYPE changed
-- (text -> varchar). CREATE OR REPLACE cannot change a return type, so the
-- engine must drop+recreate f1 (a "replace"). The rule below is byte-identical
-- to side a (the call renders the same regardless of return type), so it is only
-- rebuilt if the rule -> f1 dependency edge exists.
CREATE FUNCTION test_schema.f1(text) RETURNS varchar
  LANGUAGE sql IMMUTABLE AS $$ SELECT 'f1:' || $1 $$;

CREATE RULE log_insert AS
  ON INSERT TO test_schema.events
  DO ALSO INSERT INTO test_schema.audit_log (msg)
  VALUES (test_schema.f1(NEW.name));
