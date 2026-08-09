CREATE SCHEMA test_schema;

CREATE AGGREGATE test_schema.collect_text(text)
(
  SFUNC = pg_catalog.array_append,
  STYPE = text[],
  INITCOND = '{}'
);

COMMENT ON AGGREGATE test_schema.collect_text(text) IS 'aggregate comment';
