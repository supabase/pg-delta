CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.format_id(id integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$SELECT 'id:' || id::text$function$;

CREATE TABLE test_schema.items (id integer);

CREATE VIEW test_schema.items_formatted AS
  SELECT test_schema.format_id(id) AS formatted_id FROM test_schema.items;
