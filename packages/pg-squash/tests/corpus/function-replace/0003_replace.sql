CREATE OR REPLACE FUNCTION fr_label(n int) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'val:' || n::text $fn$;
