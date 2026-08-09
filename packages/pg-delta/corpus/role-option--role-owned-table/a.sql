-- state A: role exists with schema, no table yet
CREATE ROLE extraction_test_role NOLOGIN;
CREATE SCHEMA test_schema;
GRANT USAGE ON SCHEMA test_schema TO extraction_test_role;
GRANT CREATE ON SCHEMA test_schema TO extraction_test_role;
