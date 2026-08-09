-- events_2025 is attached as a partition of events
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  created_at timestamp without time zone NOT NULL,
  payload text
) PARTITION BY RANGE (created_at);

CREATE TABLE test_schema.events_2025 (
  created_at timestamp without time zone NOT NULL,
  payload text
);

ALTER TABLE test_schema.events
  ATTACH PARTITION test_schema.events_2025
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
