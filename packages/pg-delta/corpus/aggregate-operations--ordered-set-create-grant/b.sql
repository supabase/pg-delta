DO $$ BEGIN CREATE ROLE corpus_aggregate_executor NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE FUNCTION public.os_last_sfunc(state anyelement, value anyelement)
  RETURNS anyelement LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;

CREATE AGGREGATE public.os_last(anyelement ORDER BY anyelement)
(
  SFUNC = public.os_last_sfunc,
  STYPE = anyelement
);

GRANT ALL ON FUNCTION public.os_last(anyelement, anyelement) TO corpus_aggregate_executor;
