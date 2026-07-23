-- state B: same function, only the PUBLIC EXECUTE default is revoked. The diff
-- must emit `REVOKE ALL ... FROM PUBLIC` (forward) and re-grant EXECUTE TO
-- PUBLIC (reverse) — issue #308's second manifestation was an EMPTY diff here.
CREATE FUNCTION public.secret_fn() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
REVOKE EXECUTE ON FUNCTION public.secret_fn() FROM PUBLIC;
