CREATE SCHEMA corpus_test_schema;
CREATE FOREIGN DATA WRAPPER corpus_fdw1;
CREATE SERVER corpus_server1 FOREIGN DATA WRAPPER corpus_fdw1;
CREATE FOREIGN TABLE corpus_test_schema.ft (id integer, qty integer) SERVER corpus_server1;
ALTER FOREIGN TABLE corpus_test_schema.ft ADD CONSTRAINT ft_qty_check CHECK (qty > 0);
