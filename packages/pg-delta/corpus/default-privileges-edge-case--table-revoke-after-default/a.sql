-- state A: default privileges grant ALL to anon; table exists with default grants applied
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE TABLE public.test (
  id integer PRIMARY KEY,
  data text
);
