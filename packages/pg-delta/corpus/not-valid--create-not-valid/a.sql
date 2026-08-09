-- table exists with no constraint
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.messages (
  payload jsonb,
  binary_payload bytea
);
