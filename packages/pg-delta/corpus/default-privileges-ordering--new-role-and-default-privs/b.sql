-- state B: new role and default privileges for that role
-- CREATE ROLE must be ordered before ALTER DEFAULT PRIVILEGES FOR ROLE
CREATE ROLE app_user NOLOGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public
  GRANT SELECT ON TABLES TO app_user;
