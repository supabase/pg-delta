-- state A: view-level SELECT, UPDATE grants on a view
DO $$ BEGIN CREATE ROLE corpus_r_view_priv NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE VIEW test_schema.v_priv AS SELECT 1 AS a, 2 AS b, 3 AS c;
GRANT SELECT, UPDATE ON test_schema.v_priv TO corpus_r_view_priv;
