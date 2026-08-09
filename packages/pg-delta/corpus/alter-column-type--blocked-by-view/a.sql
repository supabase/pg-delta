CREATE SCHEMA t;
CREATE TABLE t.users (id integer PRIMARY KEY, age numeric);
CREATE VIEW t.user_ages AS SELECT id, age FROM t.users WHERE age > 0;
