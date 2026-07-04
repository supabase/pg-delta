DO $$ BEGIN CREATE ROLE corpus_extacl_g NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE EXTENSION hstore SCHEMA public;
