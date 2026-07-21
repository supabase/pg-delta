INSERT INTO test_schema.tasks (id, title, priority, assigned_to) VALUES (1, 'Fix bug', 'high', 'Alice');
INSERT INTO test_schema.task_history (id, task_id, old_priority, new_priority) VALUES (1, 1, 'medium', 'high');
