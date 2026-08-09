CREATE SCHEMA t;
CREATE TABLE t.profiles (id uuid PRIMARY KEY, role text);
ALTER TABLE t.profiles ENABLE ROW LEVEL SECURITY;
-- a new parameter changes the signature -> different function; the policy
-- that calls it must be dropped before DROP FUNCTION and recreated after
CREATE FUNCTION t.check_role(_id uuid, _role text, _extra text DEFAULT 'd') RETURNS boolean
  LANGUAGE plpgsql AS $$ BEGIN RETURN true; END; $$;
CREATE POLICY check_role_policy ON t.profiles FOR SELECT
  USING (t.check_role(id, role));
