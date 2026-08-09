DO $$ BEGIN CREATE ROLE corpus_aggregate_executor NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA test_schema;

CREATE AGGREGATE test_schema.collect_text(text)
(
  SFUNC = pg_catalog.array_append,
  STYPE = text[],
  INITCOND = '{}'
);
