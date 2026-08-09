-- a default privilege REVOKES the built-in PUBLIC EXECUTE on new functions,
-- so a co-created function does NOT get PUBLIC EXECUTE automatically.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE SCHEMA test_schema;
