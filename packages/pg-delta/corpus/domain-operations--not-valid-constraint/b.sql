-- domain carries a CHECK constraint added as NOT VALID (convalidated = false).
-- NOT VALID is only legal on ALTER DOMAIN ... ADD CONSTRAINT, never inline on
-- CREATE DOMAIN, so plan-from-empty must emit a standalone ALTER DOMAIN action
-- rather than splicing "NOT VALID" into CREATE DOMAIN.
CREATE SCHEMA test_schema;

CREATE DOMAIN test_schema.positive_int AS integer;

ALTER DOMAIN test_schema.positive_int
  ADD CONSTRAINT positive_int_check CHECK (VALUE > 0) NOT VALID;
