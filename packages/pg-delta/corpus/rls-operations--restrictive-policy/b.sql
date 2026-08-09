CREATE SCHEMA secure;
CREATE TABLE secure.sensitive_data (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  classification TEXT NOT NULL
);
ALTER TABLE secure.sensitive_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON secure.sensitive_data
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (true);
