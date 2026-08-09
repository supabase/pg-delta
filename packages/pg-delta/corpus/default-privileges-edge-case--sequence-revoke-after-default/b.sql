-- state B: sequence created with default grants, then anon explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE SEQUENCE public.test_seq;
REVOKE ALL ON SEQUENCE public.test_seq FROM corpus_anon;
