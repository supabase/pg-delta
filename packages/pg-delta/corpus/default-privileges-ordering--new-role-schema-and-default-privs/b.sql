-- state B: new role, new schema, and default privileges for that role in that schema
-- both CREATE ROLE and CREATE SCHEMA must be ordered before ALTER DEFAULT PRIVILEGES
CREATE ROLE app_user NOLOGIN;
CREATE SCHEMA app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA app
  GRANT ALL ON TABLES TO app_user;
