-- state B: same effective membership as A — child_role is a member of parent_role —
-- but granted by TWO grantors (postgres and admin_grantor), producing two
-- pg_auth_members rows for (parent_role, child_role) on PG16+.
-- After grantor dedup the membership fact is identical to A, so both the forward
-- (A->B) and reverse (B->A) membership plans must be empty: no GRANT/REVOKE of
-- parent_role to/from child_role.
CREATE ROLE admin_grantor CREATEROLE;
CREATE ROLE parent_role NOLOGIN;
CREATE ROLE child_role NOLOGIN;
GRANT parent_role TO admin_grantor WITH ADMIN OPTION;
GRANT parent_role TO child_role;
SET ROLE admin_grantor;
GRANT parent_role TO child_role;
RESET ROLE;
