CREATE SCHEMA corpus_ft;
CREATE FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE SERVER corpus_ft_server FOREIGN DATA WRAPPER corpus_ft_fdw;
CREATE FOREIGN TABLE corpus_ft.ft (id integer) SERVER corpus_ft_server
  OPTIONS (schema_name 'public', table_name 'remote_b', updatable 'false');
