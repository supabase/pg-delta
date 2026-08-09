-- state B: parent_role has child_role as member granted by two grantors
-- (PG16+ allows multiple pg_auth_members rows for same role/member pair with different grantors)
-- The effective membership should deduplicate to a single GRANT in the plan.
CREATE ROLE admin_grantor CREATEROLE;
CREATE ROLE parent_role NOLOGIN;
CREATE ROLE child_role NOLOGIN;
GRANT parent_role TO admin_grantor WITH ADMIN OPTION;
GRANT parent_role TO child_role;
SET ROLE admin_grantor;
GRANT parent_role TO child_role;
RESET ROLE;
