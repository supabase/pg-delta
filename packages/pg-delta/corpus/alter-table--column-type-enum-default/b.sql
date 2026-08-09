-- column type changed from text to enum, default cast to enum literal
CREATE SCHEMA test_schema;

CREATE TYPE test_schema.status AS ENUM ('active', 'inactive', 'archived');

CREATE TABLE test_schema.items (
  id integer NOT NULL,
  state test_schema.status NOT NULL DEFAULT 'active'::test_schema.status
);
