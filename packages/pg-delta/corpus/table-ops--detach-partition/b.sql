-- events_2025 has been detached; it becomes a standalone table
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  created_at timestamp without time zone NOT NULL,
  payload text
) PARTITION BY RANGE (created_at);

CREATE TABLE test_schema.events_2025 (
  created_at timestamp without time zone NOT NULL,
  payload text
);
