CREATE SCHEMA t;
-- age retyped numeric -> integer; a view references the column, so the view
-- must be dropped before ALTER COLUMN TYPE and recreated after
CREATE TABLE t.users (id integer PRIMARY KEY, age integer);
CREATE VIEW t.user_ages AS SELECT id, age FROM t.users WHERE age > 0;
