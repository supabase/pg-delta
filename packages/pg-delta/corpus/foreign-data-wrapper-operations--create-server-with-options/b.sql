CREATE FOREIGN DATA WRAPPER corpus_test_fdw;
CREATE SERVER corpus_test_server TYPE 'postgres_fdw' VERSION '1.0'
  FOREIGN DATA WRAPPER corpus_test_fdw OPTIONS (host 'localhost', port '5432');
