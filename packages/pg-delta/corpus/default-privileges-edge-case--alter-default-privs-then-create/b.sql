-- state B: default privileges revoked for anon, then two tables created (no anon access)
-- first_table additionally has an explicit REVOKE to match the desired final state
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM corpus_anon;
CREATE TABLE public.first_table (
  id integer PRIMARY KEY,
  data text
);
CREATE TABLE public.second_table (
  id integer PRIMARY KEY,
  data text
);
