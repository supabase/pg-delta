-- state B: FDW + server with password option (sensitive option must be redacted in plan)
CREATE FOREIGN DATA WRAPPER corpus_test_fdw;
CREATE SERVER corpus_test_server
  FOREIGN DATA WRAPPER corpus_test_fdw
  OPTIONS (password 'secret123', user 'testuser', host 'localhost');
