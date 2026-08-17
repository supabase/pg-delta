ALTER TABLE billing.invoices
  ADD CONSTRAINT invoices_account_fk
  FOREIGN KEY (account_id) REFERENCES crm.accounts (id);
