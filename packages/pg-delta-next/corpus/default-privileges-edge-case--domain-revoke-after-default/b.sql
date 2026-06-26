-- state B: domain created with default grants, then anon explicitly revoked
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TYPES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE DOMAIN public.test_domain AS integer;
REVOKE ALL ON DOMAIN public.test_domain FROM corpus_anon;
