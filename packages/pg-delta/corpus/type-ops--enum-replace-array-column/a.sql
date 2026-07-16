CREATE SCHEMA test_schema;

-- Enum with 6 values
CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high', 'critical', 'urgent', 'blocked');

CREATE TABLE test_schema.tasks (
  id integer PRIMARY KEY,
  priority test_schema.priority,
  tags test_schema.priority[]
);
