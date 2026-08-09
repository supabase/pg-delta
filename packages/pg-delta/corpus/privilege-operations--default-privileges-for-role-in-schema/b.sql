-- state B: ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_g IN SCHEMA test_schema grants SELECT on TABLES to r_def_g
CREATE ROLE r_def_g NOLOGIN;
CREATE ROLE owner_role_g NOLOGIN;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_g IN SCHEMA test_schema GRANT SELECT ON TABLES TO r_def_g;
