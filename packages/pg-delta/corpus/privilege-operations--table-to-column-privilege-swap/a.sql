-- state A: table-level INSERT, UPDATE granted to corpus_priv
DO $$ BEGIN CREATE ROLE corpus_priv NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_priv (a int, b int, c int);
GRANT INSERT, UPDATE ON TABLE test_schema.t_priv TO corpus_priv;
