-- root (PARTITION BY LIST) → events_us (a partition that is ITSELF
-- PARTITION BY RANGE) → events_us_2024 (leaf). The middle partition must
-- retain its PARTITION BY clause or the leaf cannot attach.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  id integer NOT NULL,
  region text NOT NULL,
  created_on date NOT NULL
) PARTITION BY LIST (region);

CREATE TABLE test_schema.events_us PARTITION OF test_schema.events
  FOR VALUES IN ('us')
  PARTITION BY RANGE (created_on);

CREATE TABLE test_schema.events_us_2024 PARTITION OF test_schema.events_us
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
