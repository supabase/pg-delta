CREATE SCHEMA ecommerce;
DO $$ BEGIN CREATE ROLE corpus_ecommerce_admin LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_ecommerce_user LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_analytics_user LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE ecommerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
CREATE TYPE ecommerce.priority_level AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE OR REPLACE FUNCTION ecommerce.validate_amount(amount decimal)
RETURNS boolean AS $$
BEGIN
  RETURN amount > 0 AND amount < 1000000;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ecommerce.calculate_tax(amount decimal)
RETURNS decimal AS $$
BEGIN
  RETURN amount * 0.08;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE ecommerce.customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  created_at timestamp DEFAULT now()
);

CREATE TABLE ecommerce.categories (
  id integer PRIMARY KEY,
  name text NOT NULL,
  parent_id integer
);

CREATE TABLE ecommerce.products (
  id integer PRIMARY KEY,
  name text NOT NULL,
  price decimal NOT NULL,
  category_id integer,
  status text NOT NULL
);

CREATE TABLE ecommerce.orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL,
  order_date date NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  total_amount decimal NOT NULL
);

CREATE TABLE ecommerce.order_items (
  id integer PRIMARY KEY,
  order_id integer NOT NULL,
  product_id integer NOT NULL,
  quantity integer NOT NULL,
  unit_price decimal NOT NULL
);

ALTER TABLE ecommerce.products
  ADD CONSTRAINT products_category_fkey
  FOREIGN KEY (category_id) REFERENCES ecommerce.categories(id);

ALTER TABLE ecommerce.categories
  ADD CONSTRAINT categories_parent_fkey
  FOREIGN KEY (parent_id) REFERENCES ecommerce.categories(id);

ALTER TABLE ecommerce.orders
  ADD CONSTRAINT orders_customer_fkey
  FOREIGN KEY (customer_id) REFERENCES ecommerce.customers(id);

ALTER TABLE ecommerce.order_items
  ADD CONSTRAINT order_items_order_fkey
  FOREIGN KEY (order_id) REFERENCES ecommerce.orders(id);

ALTER TABLE ecommerce.order_items
  ADD CONSTRAINT order_items_product_fkey
  FOREIGN KEY (product_id) REFERENCES ecommerce.products(id);

ALTER TABLE ecommerce.orders
  ADD CONSTRAINT orders_status_valid
  CHECK (status::ecommerce.order_status IS NOT NULL);

ALTER TABLE ecommerce.orders
  ADD CONSTRAINT orders_priority_valid
  CHECK (priority::ecommerce.priority_level IS NOT NULL);

ALTER TABLE ecommerce.orders
  ADD CONSTRAINT orders_amount_valid
  CHECK (ecommerce.validate_amount(total_amount));

ALTER TABLE ecommerce.order_items
  ADD CONSTRAINT order_items_quantity_valid
  CHECK (quantity > 0);

ALTER TABLE ecommerce.order_items
  ADD CONSTRAINT order_items_price_valid
  CHECK (ecommerce.validate_amount(unit_price));

CREATE VIEW ecommerce.customer_orders AS
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  c.email,
  COUNT(o.id) AS order_count,
  SUM(o.total_amount) AS total_spent
FROM ecommerce.customers c
LEFT JOIN ecommerce.orders o ON c.id = o.customer_id
GROUP BY c.id, c.name, c.email;

CREATE VIEW ecommerce.product_sales AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  SUM(oi.quantity) AS total_sold,
  SUM(oi.quantity * oi.unit_price) AS total_revenue
FROM ecommerce.products p
LEFT JOIN ecommerce.order_items oi ON p.id = oi.product_id
GROUP BY p.id, p.name;

CREATE MATERIALIZED VIEW ecommerce.daily_sales AS
SELECT
  order_date,
  COUNT(*) AS order_count,
  SUM(total_amount) AS total_revenue,
  AVG(total_amount) AS avg_order_value
FROM ecommerce.orders
GROUP BY order_date;

CREATE INDEX idx_orders_customer_date ON ecommerce.orders(customer_id, order_date);
CREATE INDEX idx_orders_status ON ecommerce.orders(status);
CREATE INDEX idx_order_items_order ON ecommerce.order_items(order_id);
CREATE INDEX idx_products_category ON ecommerce.products(category_id);
CREATE INDEX idx_categories_parent ON ecommerce.categories(parent_id);

ALTER TABLE ecommerce.customers OWNER TO corpus_ecommerce_admin;
ALTER TABLE ecommerce.products OWNER TO corpus_ecommerce_admin;
ALTER TABLE ecommerce.categories OWNER TO corpus_ecommerce_admin;
ALTER TABLE ecommerce.orders OWNER TO corpus_ecommerce_user;
ALTER TABLE ecommerce.order_items OWNER TO corpus_ecommerce_user;
ALTER VIEW ecommerce.customer_orders OWNER TO corpus_analytics_user;
ALTER VIEW ecommerce.product_sales OWNER TO corpus_analytics_user;
ALTER MATERIALIZED VIEW ecommerce.daily_sales OWNER TO corpus_analytics_user;
