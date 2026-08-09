-- orders references customers; both tables are new (referencing table defined first in DDL)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE
);

CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL,
  order_date date,
  CONSTRAINT orders_customer_fkey
    FOREIGN KEY (customer_id) REFERENCES test_schema.customers (id)
);
