CREATE SCHEMA test_schema;

-- Function used in a CHECK constraint; must be created before the constraint
CREATE FUNCTION test_schema.validate_email(email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
 SELECT email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
$function$;

CREATE TABLE test_schema.users (
  email text,
  CONSTRAINT valid_email CHECK (test_schema.validate_email(email))
);

-- Function used in a view; must be created before the view
CREATE FUNCTION test_schema.format_price(price numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT '$' || price::text$function$;

CREATE TABLE test_schema.products (price numeric(10,2));

CREATE VIEW test_schema.product_display AS
  SELECT test_schema.format_price(price) AS formatted_price
  FROM test_schema.products;
