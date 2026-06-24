SET check_function_bodies = false

CREATE FUNCTION test_schema.add_numbers(a integer, b integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT $1 + $2$function$