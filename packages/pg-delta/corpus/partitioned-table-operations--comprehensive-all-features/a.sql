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
