CREATE SCHEMA test_schema;

-- Shared id generator used as DEFAULT by both tables
CREATE FUNCTION test_schema.generate_id()
RETURNS bigint
LANGUAGE sql
VOLATILE
AS $function$SELECT floor(random() * 1000000)::bigint$function$;

CREATE TABLE test_schema.customers (
  id bigint PRIMARY KEY DEFAULT test_schema.generate_id(),
  email text NOT NULL,
  name text
);

CREATE TABLE test_schema.products (
  id bigint PRIMARY KEY DEFAULT test_schema.generate_id(),
  title text NOT NULL,
  price numeric(10,2)
);

-- Functions returning SETOF the tables (each depends on the corresponding table)
CREATE FUNCTION test_schema.get_customers_by_email(search_email text)
RETURNS SETOF test_schema.customers
LANGUAGE sql
STABLE
AS $function$
  SELECT * FROM test_schema.customers WHERE email = search_email
$function$;

CREATE FUNCTION test_schema.get_products_by_price(max_price numeric)
RETURNS SETOF test_schema.products
LANGUAGE sql
STABLE
AS $function$
  SELECT * FROM test_schema.products WHERE price <= max_price
$function$;

CREATE FUNCTION test_schema.get_customer_count()
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$SELECT count(*) FROM test_schema.customers$function$;
