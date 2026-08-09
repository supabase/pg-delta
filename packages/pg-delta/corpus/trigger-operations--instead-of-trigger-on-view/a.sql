CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  email text NOT NULL
);

CREATE FUNCTION test_schema.insert_user_email()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO test_schema.users (id, email) VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$;

CREATE FUNCTION test_schema.update_user_email()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE test_schema.users SET email = NEW.email WHERE id = OLD.id;
    RETURN NEW;
END;
$$;

CREATE VIEW test_schema.user_emails AS
  SELECT id, email FROM test_schema.users;
