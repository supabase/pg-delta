CREATE SCHEMA test_schema;

-- Enum with 4 values (urgent and blocked removed) — forces the rebuild path
CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE test_schema.tasks (
  id integer PRIMARY KEY,
  priority test_schema.priority,
  tags test_schema.priority[]
);
