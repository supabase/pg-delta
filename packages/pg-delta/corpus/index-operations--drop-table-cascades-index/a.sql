CREATE SCHEMA test_schema;

CREATE TABLE test_schema.test_table (
  id integer PRIMARY KEY,
  name text
);

CREATE INDEX test_table_name_index ON test_schema.test_table (name);
