-- users gains PK, UNIQUE, and CHECK constraints; products drops its CHECK constraint
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer NOT NULL,
  email character varying(255) NOT NULL,
  age integer,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_age_check CHECK (age >= 0)
);

CREATE TABLE test_schema.products (
  id integer NOT NULL,
  price numeric(10,2) NOT NULL
);
