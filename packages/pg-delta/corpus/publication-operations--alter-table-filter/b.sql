CREATE SCHEMA pub_test;
CREATE TABLE pub_test.accounts (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'inactive',
  amount INTEGER
);
-- column list widened + row filter changed: a per-table column/WHERE change
-- has no in-place form, so the published table is dropped and re-added
CREATE PUBLICATION pub_accounts
  FOR TABLE pub_test.accounts (id, status, amount)
  WHERE (amount > 0);
