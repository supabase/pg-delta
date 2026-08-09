CREATE SCHEMA app;
CREATE TABLE app.accounts (
  id INTEGER PRIMARY KEY
);
CREATE FUNCTION app.is_admin() RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  AS $$ SELECT true $$;
ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_access ON app.accounts
  FOR SELECT
  TO public
  USING (app.is_admin());
