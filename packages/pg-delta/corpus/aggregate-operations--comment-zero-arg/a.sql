CREATE SCHEMA test_schema;

CREATE AGGREGATE test_schema.count_all(*)
(
  SFUNC = pg_catalog.int8inc,
  STYPE = int8,
  INITCOND = '0'
);
