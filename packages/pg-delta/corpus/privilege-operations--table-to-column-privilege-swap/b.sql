-- state B: table-level INSERT, UPDATE revoked; replaced by column-level grants
-- (planner must emit the table-level REVOKE before the column-level GRANTs)
DO $$ BEGIN CREATE ROLE corpus_priv NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_priv (a int, b int, c int);
GRANT INSERT (a, b) ON TABLE test_schema.t_priv TO corpus_priv;
GRANT UPDATE (b) ON TABLE test_schema.t_priv TO corpus_priv;
