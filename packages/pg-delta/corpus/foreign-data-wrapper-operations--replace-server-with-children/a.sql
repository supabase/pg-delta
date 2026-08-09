-- The server's FOREIGN DATA WRAPPER differs between states (fdw1 → fdw2), which
-- forces a server replace (there is no ALTER SERVER … FOREIGN DATA WRAPPER). A
-- foreign table and a user mapping depend on the server in BOTH states, so the
-- DROP SERVER (RESTRICT) fails unless those dependents are rebuilt around it.
CREATE SCHEMA corpus_test_schema;

CREATE FOREIGN DATA WRAPPER corpus_fdw1;
CREATE FOREIGN DATA WRAPPER corpus_fdw2;

CREATE SERVER corpus_server FOREIGN DATA WRAPPER corpus_fdw1;

CREATE USER MAPPING FOR CURRENT_USER SERVER corpus_server;

CREATE FOREIGN TABLE corpus_test_schema.remote_items (id integer) SERVER corpus_server;
