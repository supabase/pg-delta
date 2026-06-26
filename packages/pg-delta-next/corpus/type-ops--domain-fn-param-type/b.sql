CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.check_prefix(val text, prefix text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
SELECT starts_with(val, prefix)
$function$;

CREATE DOMAIN test_schema.user_id AS text
  CHECK (test_schema.check_prefix(VALUE, 'user_'));

CREATE FUNCTION test_schema.normalize_user_id(input test_schema.user_id)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
SELECT lower(input::text)
$function$;
