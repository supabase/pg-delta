-- state B: view created with default grants, then anon explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE VIEW public.test_view AS SELECT 1 AS id;
REVOKE ALL ON public.test_view FROM corpus_anon;
