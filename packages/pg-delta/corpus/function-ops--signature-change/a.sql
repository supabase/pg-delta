CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.lookup(id integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$SELECT id$function$;
