-- state B: SELECT on all columns plus UPDATE (b) column privilege
DO $$ BEGIN CREATE ROLE corpus_col_g NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.tcg_g (a int, b int);
GRANT SELECT (a, b) ON TABLE test_schema.tcg_g TO corpus_col_g;
GRANT UPDATE (b) ON TABLE test_schema.tcg_g TO corpus_col_g;
