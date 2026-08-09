-- state A: both SELECT and INSERT granted to corpus_obj_r
DO $$ BEGIN CREATE ROLE corpus_obj_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t (a int);
GRANT SELECT, INSERT ON TABLE test_schema.t TO corpus_obj_r;
