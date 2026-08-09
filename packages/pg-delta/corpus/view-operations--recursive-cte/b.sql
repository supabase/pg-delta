CREATE SCHEMA test_schema;

CREATE TABLE test_schema.employees (
  id integer,
  name text,
  manager_id integer
);

-- This is a valid recursive pattern using CTE, not a cycle
CREATE VIEW test_schema.employee_hierarchy AS
WITH RECURSIVE hierarchy AS (
  SELECT id, name, manager_id, 0 as level
  FROM test_schema.employees
  WHERE manager_id IS NULL

  UNION ALL

  SELECT e.id, e.name, e.manager_id, h.level + 1
  FROM test_schema.employees e
  JOIN hierarchy h ON e.manager_id = h.id
)
SELECT * FROM hierarchy;
