CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  email character varying(255)
);

CREATE TABLE test_schema.sales (
  id integer,
  region character varying(50),
  product_id integer,
  sale_date date
);
