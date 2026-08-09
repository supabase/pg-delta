-- state B: INSERT revoked, UPDATE granted (disjoint privilege swap on same table+role)
DO $$ BEGIN CREATE ROLE corpus_swap_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_swap (a int);
GRANT UPDATE ON TABLE test_schema.t_swap TO corpus_swap_r;
