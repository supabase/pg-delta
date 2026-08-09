-- events_2025 is currently a partition of events
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  created_at timestamp without time zone NOT NULL,
  payload text
) PARTITION BY RANGE (created_at);

CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
