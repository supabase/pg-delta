CREATE TABLE billing.invoices (
  id int PRIMARY KEY,
  account_id int NOT NULL,
  cents int NOT NULL CHECK (cents >= 0)
);
