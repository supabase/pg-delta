-- table with a CHECK constraint but no comment on it yet
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  id integer PRIMARY KEY,
  created_at timestamp
);

ALTER TABLE test_schema.events ADD CONSTRAINT events_created_at_not_null CHECK (created_at IS NOT NULL);
