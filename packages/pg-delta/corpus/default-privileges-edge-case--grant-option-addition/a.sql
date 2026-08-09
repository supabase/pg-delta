-- state A: default privileges grant SELECT on TABLES (no grant option)
DO $$ BEGIN CREATE ROLE corpus_r_def_go_add NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_owner_role_go_add NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_owner_role_go_add IN SCHEMA test_schema GRANT SELECT ON TABLES TO corpus_r_def_go_add;
