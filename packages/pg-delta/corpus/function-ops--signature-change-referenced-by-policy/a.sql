CREATE SCHEMA t;
CREATE TABLE t.profiles (id uuid PRIMARY KEY, role text);
ALTER TABLE t.profiles ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION t.check_role(_id uuid, _role text) RETURNS boolean
  LANGUAGE plpgsql AS $$ BEGIN RETURN true; END; $$;
CREATE POLICY check_role_policy ON t.profiles FOR SELECT
  USING (t.check_role(id, role));
