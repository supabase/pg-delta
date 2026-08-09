CREATE SCHEMA test_schema;
CREATE TABLE test_schema.users (
  id serial PRIMARY KEY,
  email text UNIQUE,
  created_at timestamp DEFAULT now()
);
CREATE FUNCTION test_schema.validate_email()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Updated validation logic
  IF NEW.email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format: %', NEW.email;
  END IF;
  -- Additional validation
  IF length(NEW.email) > 255 THEN
    RAISE EXCEPTION 'Email too long';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER email_validation_trigger
BEFORE INSERT OR UPDATE ON test_schema.users
FOR EACH ROW
EXECUTE FUNCTION test_schema.validate_email();
