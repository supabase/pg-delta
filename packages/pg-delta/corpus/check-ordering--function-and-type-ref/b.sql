-- CHECK constraints that reference user-defined functions and enum casts;
-- exercises dependency ordering between functions/types and their dependent constraints
CREATE SCHEMA test_schema;

CREATE OR REPLACE FUNCTION test_schema.validate_price(price decimal)
RETURNS boolean AS $$
BEGIN
  RETURN price > 0 AND price < 1000000;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_schema.validate_status(status text)
RETURNS boolean AS $$
BEGIN
  RETURN status IN ('active', 'inactive', 'pending', 'archived');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE test_schema.products (
  id integer PRIMARY KEY,
  name text NOT NULL,
  price decimal NOT NULL,
  status text NOT NULL,
  CONSTRAINT products_price_valid CHECK (test_schema.validate_price(price)),
  CONSTRAINT products_status_valid CHECK (test_schema.validate_status(status))
);

CREATE TYPE test_schema.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
CREATE TYPE test_schema.priority_level AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY,
  status text NOT NULL,
  priority text NOT NULL,
  CONSTRAINT orders_status_valid CHECK (status::test_schema.order_status IS NOT NULL),
  CONSTRAINT orders_priority_valid CHECK (priority::test_schema.priority_level IS NOT NULL)
);
