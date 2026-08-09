CREATE SCHEMA test_schema;

-- Return type changed from integer to text (requires DROP + CREATE)
CREATE FUNCTION test_schema.lookup(id integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$SELECT id::text$function$;
