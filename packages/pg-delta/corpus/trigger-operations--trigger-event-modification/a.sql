CREATE SCHEMA test_schema;
CREATE TABLE test_schema.users (
  id serial PRIMARY KEY,
  email text UNIQUE,
  created_at timestamp DEFAULT now()
);
CREATE FUNCTION test_schema.validate_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER email_validation_trigger
BEFORE INSERT ON test_schema.users
FOR EACH ROW
EXECUTE FUNCTION test_schema.validate_email();
