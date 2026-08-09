-- table without generated column (base state)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.calculations (
  id integer NOT NULL,
  value_a numeric NOT NULL,
  value_b numeric NOT NULL,
  computed numeric GENERATED ALWAYS AS (value_a + value_b) STORED
);

CREATE TABLE test_schema.users (
  id integer NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL
);
