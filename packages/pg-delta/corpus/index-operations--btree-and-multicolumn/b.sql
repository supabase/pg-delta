CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  email character varying(255)
);

CREATE INDEX idx_users_email ON test_schema.users USING btree (email);

CREATE TABLE test_schema.sales (
  id integer,
  region character varying(50),
  product_id integer,
  sale_date date
);

CREATE INDEX idx_sales_region_date ON test_schema.sales USING btree (region, sale_date);
