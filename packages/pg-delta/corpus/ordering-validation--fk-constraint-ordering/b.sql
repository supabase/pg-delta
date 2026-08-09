-- state B: orders table with FK to customers; both tables new
-- FK constraint requires customers to exist before orders FK is added
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.customers (
  id integer PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY,
  customer_id integer,
  order_date date,
  CONSTRAINT orders_customer_fkey FOREIGN KEY (customer_id)
    REFERENCES test_schema.customers (id)
);
