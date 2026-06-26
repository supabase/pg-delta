CREATE SCHEMA commerce;
CREATE TYPE commerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
CREATE DOMAIN commerce.price AS DECIMAL(10,2) CHECK (VALUE >= 0);
CREATE TYPE commerce.product_info AS (
  name TEXT,
  description TEXT,
  unit_price commerce.price
);
CREATE TABLE commerce.products (
  id INTEGER PRIMARY KEY,
  info commerce.product_info,
  category TEXT
);
CREATE TABLE commerce.orders (
  id INTEGER PRIMARY KEY,
  status commerce.order_status DEFAULT 'pending',
  total_amount commerce.price
);
