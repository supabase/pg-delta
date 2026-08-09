-- state B: SELECT granted WITH GRANT OPTION (grant option added)
DO $$ BEGIN CREATE ROLE corpus_obj_go NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.tg2 (a int);
GRANT SELECT ON TABLE test_schema.tg2 TO corpus_obj_go WITH GRANT OPTION;
