CREATE OR REPLACE FUNCTION test_schema.add_numbers(a integer, b integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT $1 + $2$function$
