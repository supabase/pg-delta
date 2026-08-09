-- state B: the rewrite rule is CREATED already DISABLED. A fresh CREATE RULE
-- lands enabled (origin); the create path must append the follow-up
-- `ALTER TABLE … DISABLE RULE …` so the disabled state converges (the
-- rule's ev_enabled is hashed, so an enabled-vs-disabled gap never converges).
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.accounts (
  id serial PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0
);
CREATE RULE prevent_negative_balance AS
  ON INSERT TO test_schema.accounts
  WHERE (NEW.balance < 0)
  DO INSTEAD NOTHING;
ALTER TABLE test_schema.accounts DISABLE RULE prevent_negative_balance;
