-- state A: default privileges grant SELECT, INSERT on TABLES WITH GRANT OPTION
DO $$ BEGIN CREATE ROLE corpus_r_def_go NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_owner_role_go NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_owner_role_go IN SCHEMA test_schema GRANT SELECT, INSERT ON TABLES TO corpus_r_def_go WITH GRANT OPTION;
