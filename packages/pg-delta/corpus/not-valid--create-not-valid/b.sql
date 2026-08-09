-- CHECK constraint added with NOT VALID (should not trigger a VALIDATE CONSTRAINT step)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.messages (
  payload jsonb,
  binary_payload bytea,
  CONSTRAINT messages_payload_exclusive
    CHECK (payload IS NULL OR binary_payload IS NULL) NOT VALID
);
