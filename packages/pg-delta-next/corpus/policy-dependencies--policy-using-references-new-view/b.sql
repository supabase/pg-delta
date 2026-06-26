CREATE SCHEMA app;
CREATE TABLE app.accounts (
  id INTEGER PRIMARY KEY,
  active BOOLEAN NOT NULL
);
CREATE VIEW app.active_accounts AS
  SELECT id FROM app.accounts WHERE active;
ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_access ON app.accounts
  FOR SELECT
  TO public
  USING (id IN (SELECT id FROM app.active_accounts));
