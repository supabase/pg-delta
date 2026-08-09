CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text,
  email text,
  created_at timestamp DEFAULT NOW()
);

CREATE TABLE test_schema.orders (
  id integer,
  user_id integer,
  amount decimal(10,2),
  created_at timestamp DEFAULT NOW()
);
