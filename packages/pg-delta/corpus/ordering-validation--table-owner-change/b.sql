-- state B: new role app_user created and table ownership transferred
-- CREATE ROLE must be ordered before ALTER TABLE OWNER TO
CREATE ROLE app_user LOGIN;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text
);
ALTER TABLE test_schema.users OWNER TO app_user;
