CREATE SCHEMA pub_test;
CREATE TABLE pub_test.accounts (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'inactive',
  amount INTEGER
);
