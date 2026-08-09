-- state B: table created in schema, owned by the role
CREATE ROLE extraction_test_role NOLOGIN;
CREATE SCHEMA test_schema;
GRANT USAGE ON SCHEMA test_schema TO extraction_test_role;
GRANT CREATE ON SCHEMA test_schema TO extraction_test_role;
CREATE TABLE test_schema.role_owned_table (id integer);
ALTER TABLE test_schema.role_owned_table OWNER TO extraction_test_role;
