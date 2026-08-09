DO $$ BEGIN CREATE ROLE corpus_aggregate_executor NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
