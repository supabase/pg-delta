DO $$ BEGIN CREATE ROLE corpus_proc_executor NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
