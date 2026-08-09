-- state B: table created under default ALL, then REVOKE ALL + selective re-grant
-- (SELECT to authenticated, ALL to service_role) forcing a PARTIAL revoke for
-- authenticated against the default-ALL baseline
DO $$ BEGIN CREATE ROLE corpus_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO corpus_anon, corpus_authenticated, corpus_service_role;
CREATE TABLE public.selective_table (
  id integer PRIMARY KEY,
  public_data text,
  private_data text
);
REVOKE ALL ON public.selective_table FROM corpus_anon;
REVOKE ALL ON public.selective_table FROM corpus_authenticated;
REVOKE ALL ON public.selective_table FROM corpus_service_role;
GRANT SELECT ON public.selective_table TO corpus_authenticated;
GRANT ALL ON public.selective_table TO corpus_service_role;
