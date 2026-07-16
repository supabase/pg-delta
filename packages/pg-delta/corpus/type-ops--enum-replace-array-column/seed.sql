INSERT INTO test_schema.tasks (id, priority, tags) VALUES
  (1, 'high', ARRAY['high', 'critical']::test_schema.priority[]);
