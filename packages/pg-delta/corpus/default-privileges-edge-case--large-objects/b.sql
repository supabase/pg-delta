-- state B: ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_lo GRANT SELECT ON
-- LARGE OBJECTS TO r_def_lo (PG18+; large objects are never schema-scoped, so
-- no IN SCHEMA clause is possible here — see helpers.ts DEFACL_OBJTYPE).
DO $$ BEGIN CREATE ROLE r_def_lo NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE owner_role_lo NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_lo GRANT SELECT ON LARGE OBJECTS TO r_def_lo;
