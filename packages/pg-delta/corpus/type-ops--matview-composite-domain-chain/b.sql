CREATE SCHEMA ecommerce;

-- Create types
CREATE TYPE ecommerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered');
CREATE DOMAIN ecommerce.price AS DECIMAL(10,2) CHECK (VALUE >= 0);
CREATE TYPE ecommerce.product_info AS (
  name TEXT,
  description TEXT,
  base_price ecommerce.price
);

-- Create tables using the types
CREATE TABLE ecommerce.products (
  id INTEGER PRIMARY KEY,
  info ecommerce.product_info NOT NULL,
  category TEXT
);

CREATE TABLE ecommerce.orders (
  id INTEGER PRIMARY KEY,
  status ecommerce.order_status DEFAULT 'pending',
  final_price ecommerce.price NOT NULL
);

-- Create materialized views that depend on the tables and types
CREATE MATERIALIZED VIEW ecommerce.product_pricing AS
SELECT
  id,
  (info).name as product_name,
  (info).base_price as base_price,
  category
FROM ecommerce.products
WHERE (info).base_price > 0;

CREATE MATERIALIZED VIEW ecommerce.order_summary AS
SELECT
  status,
  COUNT(*) as order_count,
  AVG(final_price) as avg_price
FROM ecommerce.orders
GROUP BY status;
