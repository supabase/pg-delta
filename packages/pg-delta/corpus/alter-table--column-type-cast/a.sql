-- amount is varchar(10); price is numeric(8,2) with default
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.orders (
  id integer NOT NULL,
  amount varchar(10)
);

CREATE TABLE test_schema.priced (
  id integer NOT NULL,
  price numeric(8,2) DEFAULT 0.00
);
