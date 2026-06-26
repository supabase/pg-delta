-- state B: aggregate created with default grants, then anon explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE AGGREGATE public.test_agg(int) (SFUNC = int4pl, STYPE = int);
REVOKE ALL ON FUNCTION public.test_agg(int) FROM corpus_anon;
