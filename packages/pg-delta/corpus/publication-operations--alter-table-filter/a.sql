CREATE SCHEMA pub_test;
CREATE TABLE pub_test.accounts (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'inactive',
  amount INTEGER
);
-- published with a narrow column list + row filter
CREATE PUBLICATION pub_accounts
  FOR TABLE pub_test.accounts (id, amount)
  WHERE (status = 'active');
