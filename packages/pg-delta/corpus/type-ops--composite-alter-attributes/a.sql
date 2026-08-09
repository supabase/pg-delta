CREATE SCHEMA test_schema;

-- a composite type USED by a table column: it cannot be dropped+recreated
-- (it is in use), so attribute changes must go through ALTER TYPE … CASCADE
CREATE TYPE test_schema.addr AS (street text, city text);

CREATE TABLE test_schema.locations (
  id integer PRIMARY KEY,
  where_at test_schema.addr
);
