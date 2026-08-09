CREATE SCHEMA test_schema;

-- w widened to bigint via ALTER TYPE … ALTER ATTRIBUTE … TYPE (unused → ok)
CREATE TYPE test_schema.dims AS (w bigint, h integer);
