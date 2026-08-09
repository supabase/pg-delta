-- state B: new schema and default privileges in that schema
-- CREATE SCHEMA must be ordered before ALTER DEFAULT PRIVILEGES IN SCHEMA
CREATE ROLE app_user NOLOGIN;
CREATE SCHEMA app;
ALTER DEFAULT PRIVILEGES FOR ROLE test IN SCHEMA app
  GRANT ALL ON TABLES TO app_user;
