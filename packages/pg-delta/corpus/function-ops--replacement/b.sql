CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.version_function()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$SELECT 'v2.0'$function$;
