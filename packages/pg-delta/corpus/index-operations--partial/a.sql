CREATE SCHEMA test_schema;

CREATE TABLE test_schema.orders (
  id integer,
  status character varying(20),
  created_at timestamp
);
