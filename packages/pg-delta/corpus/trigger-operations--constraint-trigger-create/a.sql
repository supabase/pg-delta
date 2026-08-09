CREATE SCHEMA test_schema;

CREATE TABLE test_schema.accounts (
  id serial PRIMARY KEY,
  amount integer NOT NULL,
  limit_amount integer NOT NULL
);

CREATE FUNCTION test_schema.enforce_amount_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount > NEW.limit_amount THEN
    RAISE EXCEPTION 'amount exceeds limit';
  END IF;
  RETURN NEW;
END;
$$;
