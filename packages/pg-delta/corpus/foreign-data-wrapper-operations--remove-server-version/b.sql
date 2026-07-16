-- Same server without VERSION. PostgreSQL has no ALTER SERVER grammar to unset
-- a version, so the forward diff (removal) must route to drop + recreate; the
-- reverse (adding VERSION) is a plain ALTER SERVER … VERSION.
CREATE FOREIGN DATA WRAPPER corpus_test_fdw;
CREATE SERVER corpus_test_server FOREIGN DATA WRAPPER corpus_test_fdw;
