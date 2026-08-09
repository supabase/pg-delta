CREATE SCHEMA test_schema;

-- Enum with 4 values (urgent and blocked removed)
CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE test_schema.tasks (
  id integer PRIMARY KEY,
  title text,
  priority test_schema.priority DEFAULT 'medium',
  assigned_to text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE test_schema.task_history (
  id integer PRIMARY KEY,
  task_id integer,
  old_priority test_schema.priority,
  new_priority test_schema.priority,
  changed_at timestamp DEFAULT now()
);

-- View updated to reflect reduced enum values
CREATE VIEW test_schema.high_priority_tasks AS
  SELECT id, title, assigned_to, created_at
  FROM test_schema.tasks
  WHERE priority IN ('high', 'critical');
