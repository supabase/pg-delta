DO $$ BEGIN CREATE ROLE corpus_aggregate_owner NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA test_schema;

CREATE AGGREGATE test_schema.collect_text(text)
(
  SFUNC = array_append,
  STYPE = text[],
  INITCOND = '{}'
);

ALTER AGGREGATE test_schema.collect_text(text) OWNER TO corpus_aggregate_owner;
