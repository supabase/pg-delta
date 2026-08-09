CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.version_function()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS 'SELECT ''v1.0''';
