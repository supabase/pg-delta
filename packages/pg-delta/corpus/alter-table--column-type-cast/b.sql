-- amount cast to integer; price widened to numeric(12,4) preserving default
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.orders (
  id integer NOT NULL,
  amount integer
);

CREATE TABLE test_schema.priced (
  id integer NOT NULL,
  price numeric(12,4) DEFAULT 0.00
);
