-- PARTITION BY RANGE table with two time-bounded partitions
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  created_at timestamp without time zone NOT NULL,
  payload text
) PARTITION BY RANGE (created_at);

CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
