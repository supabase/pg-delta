-- column uses text type with a text default
CREATE SCHEMA test_schema;

CREATE TYPE test_schema.status AS ENUM ('active', 'inactive', 'archived');

CREATE TABLE test_schema.items (
  id integer NOT NULL,
  state text NOT NULL DEFAULT 'active'
);
