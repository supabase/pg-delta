-- state B: server options changed to dev environment values
CREATE FOREIGN DATA WRAPPER corpus_env_fdw;
CREATE SERVER corpus_env_server
  FOREIGN DATA WRAPPER corpus_env_fdw
  OPTIONS (host 'dev.example.com', port '5433', dbname 'dev_db', fetch_size '200');
