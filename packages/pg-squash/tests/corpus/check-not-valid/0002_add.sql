ALTER TABLE cnv_accounts
  ADD CONSTRAINT cnv_accounts_balance_nonneg CHECK (balance >= 0) NOT VALID;
