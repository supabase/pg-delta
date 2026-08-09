-- state B: INSERT revoked, only SELECT remains
DO $$ BEGIN CREATE ROLE corpus_obj_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t (a int);
GRANT SELECT ON TABLE test_schema.t TO corpus_obj_r;
