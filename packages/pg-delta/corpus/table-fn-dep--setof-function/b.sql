CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id bigserial PRIMARY KEY,
  email text UNIQUE
);

CREATE FUNCTION test_schema.get_users()
RETURNS SETOF test_schema.users
LANGUAGE sql
STABLE
AS $function$SELECT * FROM test_schema.users$function$;
