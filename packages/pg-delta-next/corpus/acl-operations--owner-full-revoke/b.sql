-- the owner has ALL of its own privileges revoked (relacl has no owner row);
-- plan-from-empty must emit REVOKE ALL FROM owner, so an empty owner ACL fact
-- must be synthesized at extract.
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t (id integer);
REVOKE ALL ON TABLE test_schema.t FROM CURRENT_USER;
