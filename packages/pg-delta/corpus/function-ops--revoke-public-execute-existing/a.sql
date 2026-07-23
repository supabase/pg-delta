-- state A: the function exists with its built-in defaults (PUBLIC EXECUTE
-- intact); acl is NULL in the catalog (issue #308, alter path).
CREATE FUNCTION public.secret_fn() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
