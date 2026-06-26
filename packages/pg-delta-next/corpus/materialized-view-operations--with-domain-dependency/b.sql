CREATE SCHEMA financial;

CREATE DOMAIN financial.currency AS DECIMAL(10,2) CHECK (VALUE >= 0);

CREATE TABLE financial.transactions (
  id INTEGER PRIMARY KEY,
  amount financial.currency NOT NULL,
  description TEXT
);

CREATE MATERIALIZED VIEW financial.transaction_summary AS
SELECT
  SUM(amount) as total_amount,
  COUNT(*) as transaction_count
FROM financial.transactions
WHERE amount > 0;
