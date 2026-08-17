CREATE FUNCTION fr_label(n int) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'n=' || n::text $fn$;
