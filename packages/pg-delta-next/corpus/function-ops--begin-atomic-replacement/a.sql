CREATE SCHEMA test_schema;

CREATE TABLE test_schema.accounts (
  user_id int PRIMARY KEY,
  balance int NOT NULL DEFAULT 0
);

CREATE FUNCTION test_schema.transfer_funds(
  sender_id int, receiver_id int, amount numeric
)
RETURNS void
LANGUAGE SQL
BEGIN ATOMIC
  UPDATE test_schema.accounts
    SET balance = balance - amount WHERE user_id = sender_id;
END;
