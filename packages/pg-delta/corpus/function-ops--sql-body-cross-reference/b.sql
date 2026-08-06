CREATE SCHEMA test_schema;

-- z_helper_parse is created first so the b.sql FIXTURE applies cleanly under the
-- default check_function_bodies. The point of the scenario: a_wrapper's
-- string-literal SQL body calls z_helper_parse but records NO pg_depend edge, so
-- the engine cannot topologically order the two functions and must rely on the
-- check_function_bodies=off plan preamble (always emitted for routine-touching
-- plans like this one) to converge (a->b/b->a).
CREATE OR REPLACE FUNCTION test_schema.z_helper_parse(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT upper(input)$function$;

CREATE OR REPLACE FUNCTION test_schema.a_wrapper(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT test_schema.z_helper_parse(input) || '!'$function$;
