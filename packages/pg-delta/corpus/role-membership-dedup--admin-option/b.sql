-- state B: child_role is a member of parent_role WITH ADMIN OPTION
CREATE ROLE parent_role NOLOGIN;
CREATE ROLE child_role NOLOGIN;
GRANT parent_role TO child_role WITH ADMIN OPTION;
