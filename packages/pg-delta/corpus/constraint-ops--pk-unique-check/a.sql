-- table exists with columns but no constraints yet
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer NOT NULL,
  email character varying(255) NOT NULL,
  age integer
);

CREATE TABLE test_schema.products (
  id integer NOT NULL,
  price numeric(10,2) NOT NULL,
  CONSTRAINT products_price_check CHECK (price > 0)
);
