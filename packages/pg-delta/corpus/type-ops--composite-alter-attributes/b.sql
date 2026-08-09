CREATE SCHEMA test_schema;

-- zip added via ALTER TYPE … ADD ATTRIBUTE … CASCADE (works in-use)
CREATE TYPE test_schema.addr AS (street text, city text, zip text);

CREATE TABLE test_schema.locations (
  id integer PRIMARY KEY,
  where_at test_schema.addr
);
