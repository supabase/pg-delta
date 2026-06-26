-- state A: INSERT granted to corpus_swap_r
DO $$ BEGIN CREATE ROLE corpus_swap_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_swap (a int);
GRANT INSERT ON TABLE test_schema.t_swap TO corpus_swap_r;
