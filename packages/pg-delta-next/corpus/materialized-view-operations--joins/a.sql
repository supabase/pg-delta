CREATE SCHEMA ecommerce;

CREATE TABLE ecommerce.customers (
  id integer PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE ecommerce.orders (
  id integer PRIMARY KEY,
  customer_id integer,
  total decimal(10,2)
);
