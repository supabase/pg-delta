CREATE SCHEMA test_schema;

CREATE TABLE test_schema.user_account (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  verified boolean NOT NULL DEFAULT false
);

CREATE FUNCTION test_schema.user_account_encrypt_secret_email()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.email := 'enc:' || NEW.email;
  RETURN NEW;
END;
$$;
