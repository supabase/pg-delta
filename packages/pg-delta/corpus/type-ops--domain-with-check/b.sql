CREATE SCHEMA test_schema;

CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
