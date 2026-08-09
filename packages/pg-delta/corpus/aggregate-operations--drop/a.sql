CREATE SCHEMA test_schema;

CREATE AGGREGATE test_schema.collect_text(text)
(
  SFUNC = array_append,
  STYPE = text[],
  INITCOND = '{}'
);
