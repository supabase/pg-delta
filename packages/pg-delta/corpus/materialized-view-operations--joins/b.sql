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

CREATE MATERIALIZED VIEW ecommerce.customer_orders AS
SELECT
  c.id as customer_id,
  c.name,
  COUNT(o.id) as order_count,
  COALESCE(SUM(o.total), 0) as total_spent
FROM ecommerce.customers c
LEFT JOIN ecommerce.orders o ON c.id = o.customer_id
GROUP BY c.id, c.name
WITH NO DATA;
