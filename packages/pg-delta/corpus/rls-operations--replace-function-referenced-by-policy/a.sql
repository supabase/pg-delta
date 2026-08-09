CREATE SCHEMA app;
CREATE FUNCTION app.check_access(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN true;
END;
$$ LANGUAGE plpgsql;
CREATE TABLE app.docs (
  id integer PRIMARY KEY,
  owner_id uuid,
  content text
);
ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_policy ON app.docs
  FOR ALL
  TO public
  USING (app.check_access(owner_id));
