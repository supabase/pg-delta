CREATE SCHEMA test_schema;

-- Create enum
CREATE TYPE test_schema.user_role AS ENUM ('admin', 'user', 'moderator');

-- Create domain
CREATE DOMAIN test_schema.positive_integer AS integer
  CONSTRAINT positive_check CHECK (value > 0);

-- Create sequence
CREATE SEQUENCE test_schema.global_id_seq START 10000;

-- Create table
CREATE TABLE test_schema.users (
  id test_schema.positive_integer PRIMARY KEY DEFAULT nextval('test_schema.global_id_seq'),
  username varchar(50) UNIQUE NOT NULL,
  role test_schema.user_role DEFAULT 'user',
  created_at timestamp DEFAULT now()
);

-- Create view
CREATE VIEW test_schema.admin_users AS
  SELECT * FROM test_schema.users WHERE role = 'admin';

-- Create procedure
CREATE OR REPLACE PROCEDURE test_schema.create_admin_user(
  p_username varchar(50)
)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO test_schema.users (username, role) VALUES (p_username, 'admin');
END;
$$;
