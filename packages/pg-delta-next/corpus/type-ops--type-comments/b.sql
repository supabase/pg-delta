CREATE SCHEMA test_schema;

CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy');
CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
CREATE TYPE test_schema.address AS (
  street TEXT,
  city TEXT
);

COMMENT ON TYPE test_schema.mood IS 'mood type';
COMMENT ON DOMAIN test_schema.positive_int IS 'positive integer domain';
COMMENT ON TYPE test_schema.address IS 'address composite type';
