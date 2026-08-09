-- four tables in an ecommerce schema with a multi-level FK chain
CREATE SCHEMA ecommerce;

CREATE TABLE ecommerce.customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE NOT NULL
);

CREATE TABLE ecommerce.products (
  id integer PRIMARY KEY,
  name text NOT NULL,
  price decimal NOT NULL
);

CREATE TABLE ecommerce.orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL,
  order_date date NOT NULL,
  CONSTRAINT orders_customer_fkey
    FOREIGN KEY (customer_id) REFERENCES ecommerce.customers (id)
);

CREATE TABLE ecommerce.order_items (
  id integer PRIMARY KEY,
  order_id integer NOT NULL,
  product_id integer NOT NULL,
  quantity integer NOT NULL,
  CONSTRAINT order_items_order_fkey
    FOREIGN KEY (order_id) REFERENCES ecommerce.orders (id),
  CONSTRAINT order_items_product_fkey
    FOREIGN KEY (product_id) REFERENCES ecommerce.products (id)
);
