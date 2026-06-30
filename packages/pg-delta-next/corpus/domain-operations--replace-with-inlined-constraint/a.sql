-- existing domain with a validated CHECK constraint
CREATE SCHEMA test_schema;
CREATE DOMAIN test_schema.d AS integer CONSTRAINT d_check CHECK (VALUE > 0);
