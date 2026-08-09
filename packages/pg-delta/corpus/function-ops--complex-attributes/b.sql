CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.expensive_function(input_data text)
 RETURNS text
 LANGUAGE plpgsql
 PARALLEL RESTRICTED STRICT COST 1000
AS $function$
BEGIN
  -- Simulate expensive operation
  PERFORM pg_sleep(0.1);
  RETURN upper(input_data);
END;
$function$;
