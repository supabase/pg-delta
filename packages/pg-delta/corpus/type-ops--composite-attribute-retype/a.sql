CREATE SCHEMA test_schema;

-- a standalone composite (NOT used by any table column)
CREATE TYPE test_schema.dims AS (w integer, h integer);
