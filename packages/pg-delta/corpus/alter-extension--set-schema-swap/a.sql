-- relocatable extension living in a schema that only exists in this state.
-- ALTER EXTENSION … SET SCHEMA must run after CREATE SCHEMA of the new home
-- (consumes, already declared) and before DROP SCHEMA of the old home
-- (releases, the fix under test).
CREATE SCHEMA ext_old;

CREATE EXTENSION citext SCHEMA ext_old;
