CREATE SCHEMA app;
CREATE TABLE app.accounts (
  id INTEGER PRIMARY KEY
);
CREATE TABLE app.users (
  id INTEGER PRIMARY KEY
);
ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_access ON app.accounts
  FOR SELECT
  TO public
  USING (EXISTS (SELECT 1 FROM app.users));
