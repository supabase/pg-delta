CREATE SCHEMA test_schema;

CREATE TYPE test_schema.address AS (
  street VARCHAR(90),
  city VARCHAR(90),
  state VARCHAR(2)
);
