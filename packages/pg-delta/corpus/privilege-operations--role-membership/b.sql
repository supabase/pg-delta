-- state B: child_role_g is a member of parent_role_g WITH ADMIN OPTION
CREATE ROLE parent_role_g NOLOGIN;
CREATE ROLE child_role_g NOLOGIN;
GRANT parent_role_g TO child_role_g WITH ADMIN OPTION;
