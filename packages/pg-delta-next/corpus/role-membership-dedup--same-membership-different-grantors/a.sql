-- state A: child_role is a member of parent_role, granted by ONE grantor (postgres).
-- A single pg_auth_members row for (parent_role, child_role).
CREATE ROLE admin_grantor CREATEROLE;
CREATE ROLE parent_role NOLOGIN;
CREATE ROLE child_role NOLOGIN;
GRANT parent_role TO admin_grantor WITH ADMIN OPTION;
GRANT parent_role TO child_role;
