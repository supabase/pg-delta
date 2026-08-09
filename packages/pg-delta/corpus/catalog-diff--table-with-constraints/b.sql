CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id serial PRIMARY KEY,
  username varchar(50) UNIQUE NOT NULL,
  email varchar(255) UNIQUE NOT NULL,
  created_at timestamp DEFAULT now()
);
