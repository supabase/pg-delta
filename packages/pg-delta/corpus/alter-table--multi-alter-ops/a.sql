-- table before multiple simultaneous alterations
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.evolution (
  id integer NOT NULL,
  old_name varchar(50),
  status text DEFAULT 'pending'
);
