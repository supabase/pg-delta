DO $$ BEGIN CREATE ROLE corpus_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE FUNCTION public.add(a integer, b integer) RETURNS integer
  LANGUAGE sql IMMUTABLE AS 'SELECT a + b';
COMMENT ON FUNCTION public.add(integer, integer) IS 'adds two integers';
GRANT EXECUTE ON FUNCTION public.add(integer, integer) TO corpus_reader;
