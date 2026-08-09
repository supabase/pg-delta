CREATE SCHEMA pub_test;
CREATE TABLE pub_test.accounts (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'inactive',
  amount INTEGER
);
CREATE PUBLICATION pub_accounts_filtered
  FOR TABLE pub_test.accounts (id, amount)
  WHERE (status = 'active');
