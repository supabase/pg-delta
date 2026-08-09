-- state B: table created, anon and authenticated both explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE TABLE public.restricted_table (
  id integer PRIMARY KEY,
  sensitive_data text
);
REVOKE ALL ON public.restricted_table FROM corpus_anon;
REVOKE ALL ON public.restricted_table FROM corpus_authenticated;
