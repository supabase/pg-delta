CREATE SCHEMA test_schema;

-- Enum with fewer values
CREATE TYPE test_schema.user_role AS ENUM ('admin', 'user');

-- Domain without constraint
CREATE DOMAIN test_schema.positive_integer AS integer;

-- Sequence with low start value
CREATE SEQUENCE test_schema.global_id_seq START 1;

-- Table with fewer columns
CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  username varchar(50) NOT NULL
);

-- View with simpler definition
CREATE VIEW test_schema.admin_users AS
  SELECT id, username FROM test_schema.users WHERE id > 0;
