CREATE SCHEMA test_schema;
CREATE TABLE test_schema.products (
  product_id integer NOT NULL,
  created_on date NOT NULL,
  sku text,
  name text,
  PRIMARY KEY (product_id, created_on)
) PARTITION BY RANGE (created_on);

CREATE TABLE test_schema.products_2024 PARTITION OF test_schema.products
FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE test_schema.products_2025 PARTITION OF test_schema.products
FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

ALTER TABLE test_schema.products
ADD CONSTRAINT products_sku_key UNIQUE (sku, created_on);
