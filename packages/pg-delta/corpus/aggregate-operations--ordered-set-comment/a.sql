CREATE FUNCTION public.os_last_sfunc(state anyelement, value anyelement)
  RETURNS anyelement LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;

CREATE AGGREGATE public.os_last(anyelement ORDER BY anyelement)
(
  SFUNC = public.os_last_sfunc,
  STYPE = anyelement
);
