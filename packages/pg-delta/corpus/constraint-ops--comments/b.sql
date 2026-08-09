-- same constraint now has a COMMENT
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  id integer PRIMARY KEY,
  created_at timestamp
);

ALTER TABLE test_schema.events ADD CONSTRAINT events_created_at_not_null CHECK (created_at IS NOT NULL);

COMMENT ON CONSTRAINT events_created_at_not_null ON test_schema.events IS 'created_at must be set';
