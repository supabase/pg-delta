-- state A: table and role exist, no grants
DO $$ BEGIN CREATE ROLE corpus_obj_g NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.tg (a int);
