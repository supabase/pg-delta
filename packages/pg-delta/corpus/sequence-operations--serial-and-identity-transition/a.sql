CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  c1 int NOT NULL,
  c2 serial,
  c3 int GENERATED ALWAYS AS IDENTITY
);
