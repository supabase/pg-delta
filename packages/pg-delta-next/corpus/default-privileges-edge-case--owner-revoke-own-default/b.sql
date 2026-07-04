-- the table owner revokes one of its own create-time default privileges.
-- pg_dump-style REVOKE/GRANT must survive compaction; eliding the owner ACL
-- group as if it were the built-in default would leave UPDATE in place.
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t (id integer);
REVOKE UPDATE ON test_schema.t FROM CURRENT_USER;
