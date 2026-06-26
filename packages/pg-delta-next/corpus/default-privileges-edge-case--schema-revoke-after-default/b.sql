-- state B: schema created with default grants, then anon explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES
  GRANT ALL ON SCHEMAS TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE SCHEMA corpus_test_schema;
REVOKE ALL ON SCHEMA corpus_test_schema FROM corpus_anon;
