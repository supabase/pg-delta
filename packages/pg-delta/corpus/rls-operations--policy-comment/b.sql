CREATE SCHEMA app;
CREATE TABLE app.docs (
  id integer PRIMARY KEY,
  owner_id integer
);
ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app.docs FOR ALL TO public USING (true);
COMMENT ON POLICY owner_only ON app.docs IS 'only owners have access →';
