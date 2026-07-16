-- A zero-argument aggregate's COMMENT / SECURITY LABEL target must render the
-- signature as (*), not (): PostgreSQL requires COMMENT ON AGGREGATE name(*).
CREATE SCHEMA test_schema;

CREATE AGGREGATE test_schema.count_all(*)
(
  SFUNC = pg_catalog.int8inc,
  STYPE = int8,
  INITCOND = '0'
);

COMMENT ON AGGREGATE test_schema.count_all(*) IS 'counts all rows';
