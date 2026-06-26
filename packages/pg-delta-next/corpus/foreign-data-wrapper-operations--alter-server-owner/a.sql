DO $$ BEGIN CREATE ROLE corpus_server_owner NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE FOREIGN DATA WRAPPER corpus_test_fdw;
CREATE SERVER corpus_test_server FOREIGN DATA WRAPPER corpus_test_fdw;
