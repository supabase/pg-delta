CREATE SCHEMA test_schema;
CREATE TABLE test_schema.customers (
  customer_id integer PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE test_schema.orders (
  order_id integer NOT NULL,
  created_on date NOT NULL,
  customer_id integer NOT NULL,
  status text DEFAULT 'pending',
  total_amount numeric(10,2),
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (order_id, created_on)
) PARTITION BY RANGE (created_on);
CREATE TABLE test_schema.orders_2024 PARTITION OF test_schema.orders
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE test_schema.orders_2025 PARTITION OF test_schema.orders
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE FUNCTION test_schema.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE FUNCTION test_schema.log_order_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;
ALTER TABLE test_schema.orders
  ADD CONSTRAINT fk_orders_customer
  FOREIGN KEY (customer_id)
  REFERENCES test_schema.customers(customer_id)
  ON DELETE RESTRICT;
CREATE INDEX idx_orders_status ON test_schema.orders (status);
CREATE INDEX idx_orders_customer ON test_schema.orders (customer_id);
CREATE INDEX idx_orders_created_brin ON test_schema.orders USING brin (created_on);
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON test_schema.orders
  FOR EACH ROW
  EXECUTE FUNCTION test_schema.update_updated_at();
CREATE TRIGGER trg_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON test_schema.orders
  FOR EACH ROW
  EXECUTE FUNCTION test_schema.log_order_changes();
CREATE TABLE test_schema.order_items (
  item_id integer PRIMARY KEY,
  order_id integer NOT NULL,
  order_created_on date NOT NULL,
  product_name text,
  quantity integer
);
ALTER TABLE test_schema.order_items
  ADD CONSTRAINT fk_order_items_order
  FOREIGN KEY (order_id, order_created_on)
  REFERENCES test_schema.orders(order_id, created_on)
  ON DELETE CASCADE;
