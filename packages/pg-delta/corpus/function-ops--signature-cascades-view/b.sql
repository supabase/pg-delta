CREATE SCHEMA test_schema;

-- Argument type changed from integer to bigint (forces DROP+CREATE of function and dependent view)
CREATE FUNCTION test_schema.format_id(id bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$SELECT 'id:' || id::text$function$;

CREATE TABLE test_schema.items (id integer);

-- View recreated to use the new overload signature
CREATE VIEW test_schema.items_formatted AS
  SELECT test_schema.format_id(id::bigint) AS formatted_id FROM test_schema.items;
