CREATE FOREIGN DATA WRAPPER corpus_test_fdw;
CREATE SERVER corpus_test_server FOREIGN DATA WRAPPER corpus_test_fdw OPTIONS (host 'localhost');
