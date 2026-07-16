CREATE SCHEMA corpus_test_schema;

CREATE FOREIGN DATA WRAPPER corpus_fdw1;
CREATE FOREIGN DATA WRAPPER corpus_fdw2;

CREATE SERVER corpus_server FOREIGN DATA WRAPPER corpus_fdw2;

CREATE USER MAPPING FOR CURRENT_USER SERVER corpus_server;

CREATE FOREIGN TABLE corpus_test_schema.remote_items (id integer) SERVER corpus_server;
