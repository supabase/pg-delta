-- state B: role with LOGIN created (password is sensitive and must not appear in plan output)
DO $$ BEGIN CREATE ROLE corpus_test_login_role LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
