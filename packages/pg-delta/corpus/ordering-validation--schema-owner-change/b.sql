-- state B: new role, new schema owned by that role, table in that schema
-- CREATE ROLE must be ordered before ALTER SCHEMA OWNER TO
CREATE ROLE schema_owner LOGIN;
CREATE SCHEMA test_schema;
ALTER SCHEMA test_schema OWNER TO schema_owner;
CREATE TABLE test_schema.data (
  id integer PRIMARY KEY,
  value text
);
