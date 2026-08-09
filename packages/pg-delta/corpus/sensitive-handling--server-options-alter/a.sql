-- state A: server with initial host/port/dbname/fetch_size options
CREATE FOREIGN DATA WRAPPER corpus_env_fdw;
CREATE SERVER corpus_env_server
  FOREIGN DATA WRAPPER corpus_env_fdw
  OPTIONS (host 'prod.example.com', port '5432', dbname 'prod_db', fetch_size '100');
