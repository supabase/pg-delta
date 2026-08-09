CREATE FOREIGN DATA WRAPPER corpus_test_fdw;
CREATE SERVER corpus_test_server FOREIGN DATA WRAPPER corpus_test_fdw;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_test_user') THEN
    CREATE ROLE corpus_test_user;
  END IF;
END $$;
