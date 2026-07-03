DO $$ BEGIN CREATE ROLE corpus_extacl_d NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE EXTENSION hstore SCHEMA public;

GRANT EXECUTE ON FUNCTION hstore(text, text) TO corpus_extacl_d;
