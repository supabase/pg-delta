CREATE SCHEMA test_schema;

CREATE TABLE test_schema.accounts (
  id integer,
  email character varying(255)
);

CREATE UNIQUE INDEX idx_accounts_email ON test_schema.accounts USING btree (email) NULLS NOT DISTINCT;
