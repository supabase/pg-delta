-- state A: default privileges set for custom schema `app`; no table yet
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT ALL ON TABLES TO corpus_anon, corpus_authenticated, corpus_service_role;
