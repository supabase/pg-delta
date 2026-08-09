CREATE SCHEMA test_schema;

CREATE TABLE test_schema.products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10,2),
  category text
);

CREATE FUNCTION test_schema.log_price_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'Price changed for product %: % -> %', NEW.name, OLD.price, NEW.price;
  RETURN NEW;
END;
$$;
