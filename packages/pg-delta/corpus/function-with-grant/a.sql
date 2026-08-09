DO $$ BEGIN CREATE ROLE corpus_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
