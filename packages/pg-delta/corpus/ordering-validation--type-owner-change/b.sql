-- state B: new role, enum type owned by that role, table using the type
-- CREATE ROLE must be ordered before ALTER TYPE OWNER TO
CREATE ROLE type_owner LOGIN;
CREATE SCHEMA test_schema;
CREATE TYPE test_schema.status_enum AS ENUM ('active', 'inactive', 'pending');
ALTER TYPE test_schema.status_enum OWNER TO type_owner;
CREATE TABLE test_schema.items (
  id integer PRIMARY KEY,
  status test_schema.status_enum DEFAULT 'pending'
);
