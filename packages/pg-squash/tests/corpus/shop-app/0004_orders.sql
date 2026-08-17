CREATE TABLE shop.orders (
  id int PRIMARY KEY,
  customer_id int NOT NULL REFERENCES shop.customers (id),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  placed_at timestamptz NOT NULL DEFAULT '2020-01-02 00:00:00+00'
);
CREATE TABLE shop.order_items (
  order_id int NOT NULL REFERENCES shop.orders (id) ON DELETE CASCADE,
  product_id int NOT NULL REFERENCES shop.products (id),
  qty int NOT NULL CHECK (qty > 0),
  unit_price_cents int NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
