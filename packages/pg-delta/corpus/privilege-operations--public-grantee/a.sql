-- state A: view exists, no grants to PUBLIC
CREATE SCHEMA test_schema;
CREATE VIEW test_schema.v AS SELECT 1 AS a;
