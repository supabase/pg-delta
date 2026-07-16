-- citext relocated from ext_old to ext_new; each schema exists in only one
-- state, so the plan creates ext_new and drops ext_old around the
-- ALTER EXTENSION citext SET SCHEMA.
CREATE SCHEMA ext_new;

CREATE EXTENSION citext SCHEMA ext_new;
