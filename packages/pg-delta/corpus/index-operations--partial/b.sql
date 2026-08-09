CREATE SCHEMA test_schema;

CREATE TABLE test_schema.orders (
  id integer,
  status character varying(20),
  created_at timestamp
);

CREATE INDEX idx_orders_pending ON test_schema.orders USING btree (created_at) WHERE status::text = 'pending'::text;
