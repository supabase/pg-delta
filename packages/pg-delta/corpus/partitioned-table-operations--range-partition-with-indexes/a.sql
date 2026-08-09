CREATE SCHEMA test_schema;
CREATE TABLE test_schema.orders (
  order_id integer NOT NULL,
  created_on date NOT NULL,
  customer_id integer,
  status text,
  amount numeric(10,2)
) PARTITION BY RANGE (created_on);
CREATE TABLE test_schema.orders_2024 PARTITION OF test_schema.orders
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE test_schema.orders_2025 PARTITION OF test_schema.orders
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
