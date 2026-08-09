-- state B: UPDATE privilege granted to corpus_obj_g
DO $$ BEGIN CREATE ROLE corpus_obj_g NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.tg (a int);
GRANT UPDATE ON TABLE test_schema.tg TO corpus_obj_g;
