CREATE SCHEMA test_schema;
CREATE TABLE test_schema.idx_users (
  id integer NOT NULL
);
ALTER TABLE test_schema.idx_users ADD COLUMN email character varying(255);
ALTER TABLE test_schema.idx_users ADD CONSTRAINT users_email_key UNIQUE (email);
