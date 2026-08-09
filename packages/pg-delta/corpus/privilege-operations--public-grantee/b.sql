-- state B: SELECT granted to PUBLIC on view
CREATE SCHEMA test_schema;
CREATE VIEW test_schema.v AS SELECT 1 AS a;
GRANT SELECT ON test_schema.v TO PUBLIC;
