DO $$ BEGIN CREATE ROLE corpus_proc_executor NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A real PROCEDURE (prokind 'p'): COMMENT/GRANT must use the PROCEDURE keyword.
-- PostgreSQL rejects the FUNCTION form here ("public.do_work() is not a function").
CREATE PROCEDURE public.do_work(amount integer)
  LANGUAGE sql AS $$ SELECT amount $$;

COMMENT ON PROCEDURE public.do_work(integer) IS 'does some work';

GRANT EXECUTE ON PROCEDURE public.do_work(integer) TO corpus_proc_executor;
