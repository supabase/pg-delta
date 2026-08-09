CREATE SCHEMA test_schema;

CREATE DOMAIN test_schema.age AS integer
  CONSTRAINT age_check CHECK (VALUE >= 0 AND VALUE <= 150);
