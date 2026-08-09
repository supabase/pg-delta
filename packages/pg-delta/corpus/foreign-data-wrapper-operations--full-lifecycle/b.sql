CREATE SCHEMA corpus_test_schema;
CREATE FOREIGN DATA WRAPPER corpus_fdw1;
CREATE SERVER corpus_server1 FOREIGN DATA WRAPPER corpus_fdw1;
CREATE SERVER corpus_server2 FOREIGN DATA WRAPPER corpus_fdw1;
CREATE USER MAPPING FOR CURRENT_USER SERVER corpus_server1;
CREATE USER MAPPING FOR PUBLIC SERVER corpus_server2;
CREATE FOREIGN TABLE corpus_test_schema.table1 (id integer) SERVER corpus_server1;
CREATE FOREIGN TABLE corpus_test_schema.table2 (id integer) SERVER corpus_server2;
