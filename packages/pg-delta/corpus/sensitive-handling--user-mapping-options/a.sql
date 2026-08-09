-- state A: postgres_fdw installed, server exists, no user mapping
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER corpus_um_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'localhost');
