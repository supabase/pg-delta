CREATE SCHEMA test_schema;

CREATE TABLE test_schema.items (
  id integer,
  name character varying(100)
);

CREATE INDEX idx_items_name ON test_schema.items (name);
