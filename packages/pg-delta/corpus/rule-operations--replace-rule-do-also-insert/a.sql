CREATE SCHEMA test_schema;
CREATE TABLE test_schema.accounts (
  id serial PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0
);
CREATE TABLE test_schema.rule_events (
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE RULE prevent_negative_balance AS
  ON INSERT TO test_schema.accounts
  WHERE (NEW.balance < 0)
  DO INSTEAD NOTHING;
