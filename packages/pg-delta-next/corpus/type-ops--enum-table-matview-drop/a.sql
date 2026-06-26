CREATE SCHEMA reporting;
CREATE TYPE reporting.priority AS ENUM ('low', 'medium', 'high');
CREATE TABLE reporting.tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  priority reporting.priority DEFAULT 'medium'
);
CREATE MATERIALIZED VIEW reporting.priority_stats AS
SELECT
  priority,
  COUNT(*) as task_count
FROM reporting.tasks
GROUP BY priority;
