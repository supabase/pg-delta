CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.format_value(input_val integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT input_val::text$function$;

CREATE FUNCTION test_schema.format_value(input_val integer, prefix text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT prefix || input_val::text$function$;
