DO $$ BEGIN CREATE ROLE corpus_matview_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  age integer
);

CREATE MATERIALIZED VIEW test_schema.user_ages AS
  SELECT id, age
  FROM test_schema.users
  WHERE age > 0
  WITH NO DATA;

COMMENT ON MATERIALIZED VIEW test_schema.user_ages IS 'user ages matview';

GRANT SELECT ON test_schema.user_ages TO corpus_matview_reader;
