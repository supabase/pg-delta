CREATE SCHEMA test_schema;

-- Enum with more values
CREATE TYPE test_schema.user_role AS ENUM ('admin', 'user', 'moderator');

-- Domain with constraint
CREATE DOMAIN test_schema.positive_integer AS integer
  CONSTRAINT positive_check CHECK (VALUE > 0);

-- Sequence with higher start value
CREATE SEQUENCE test_schema.global_id_seq START 10000;

-- Table with more columns
CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  username varchar(50) NOT NULL,
  email varchar(255),
  created_at timestamp DEFAULT now()
);

-- View with more columns
CREATE VIEW test_schema.admin_users AS
  SELECT id, username, email, created_at FROM test_schema.users WHERE id > 0;
