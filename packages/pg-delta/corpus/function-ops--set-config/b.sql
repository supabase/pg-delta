CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.config_function()
 RETURNS void
 LANGUAGE plpgsql
 SET work_mem TO '256MB'
 SET statement_timeout TO '30s'
AS $function$
BEGIN
  -- Function with custom configuration
  RAISE NOTICE 'Function executed with custom config';
END;
$function$;
