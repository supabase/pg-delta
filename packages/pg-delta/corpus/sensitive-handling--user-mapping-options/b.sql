-- state B: user mapping with password (password must be redacted in plan)
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER corpus_um_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'localhost');
CREATE USER MAPPING FOR CURRENT_USER
  SERVER corpus_um_server
  OPTIONS (user 'testuser', password 'secret456');
