-- state B: a function whose built-in PUBLIC EXECUTE default is revoked, with NO
-- compensating named-role grant (issue #308's minimal repro). The lone revoke is
-- represented as the ABSENCE of the create-time default, so the create path must
-- co-emit `REVOKE ALL ... FROM PUBLIC` or the migrated function stays
-- PUBLIC-executable.
CREATE FUNCTION public.secret_fn() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
REVOKE EXECUTE ON FUNCTION public.secret_fn() FROM PUBLIC;
