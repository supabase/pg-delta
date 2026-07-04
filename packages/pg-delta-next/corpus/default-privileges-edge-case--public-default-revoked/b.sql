-- the new function IS meant to have PUBLIC EXECUTE; the co-create GRANT is
-- load-bearing (the default privilege removed PUBLIC EXECUTE), so eliding it as
-- a "matches built-in default" group leaves the function without PUBLIC EXECUTE.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE SCHEMA test_schema;
CREATE FUNCTION test_schema.f() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
GRANT EXECUTE ON FUNCTION test_schema.f() TO PUBLIC;
