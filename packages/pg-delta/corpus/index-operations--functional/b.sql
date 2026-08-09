CREATE SCHEMA test_schema;

CREATE TABLE test_schema.customers (
  id integer,
  email character varying(255)
);

CREATE INDEX idx_customers_email_lower ON test_schema.customers USING btree (lower(email::text));
