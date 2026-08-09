-- same constraint is now validated (convalidated = true); convergence should use VALIDATE CONSTRAINT
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.messages (
  payload jsonb,
  binary_payload bytea
);

ALTER TABLE test_schema.messages
  ADD CONSTRAINT messages_payload_exclusive
  CHECK (payload IS NULL OR binary_payload IS NULL);
