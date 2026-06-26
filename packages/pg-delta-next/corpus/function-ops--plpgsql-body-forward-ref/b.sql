CREATE SCHEMA test_schema;

CREATE OR REPLACE FUNCTION test_schema.a_wrapper(input text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN test_schema.z_helper_parse(input) || '!';
END;
$function$;

CREATE OR REPLACE FUNCTION test_schema.z_helper_parse(input text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN upper(input);
END;
$function$;
