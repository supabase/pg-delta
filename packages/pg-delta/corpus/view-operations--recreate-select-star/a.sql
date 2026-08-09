CREATE SCHEMA test_schema;

CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  title text NOT NULL,
  status text DEFAULT 'active'
);

CREATE VIEW test_schema.item_details AS
  SELECT i.* FROM test_schema.items i;
