-- same FK constraint is now validated (convalidated = true); convergence
-- should validate it (and the reverse direction, b -> a, exercises
-- validated -> NOT VALID)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY
);

CREATE TABLE test_schema.items (
  id integer PRIMARY KEY,
  order_id integer
);

ALTER TABLE test_schema.items
  ADD CONSTRAINT items_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES test_schema.orders (id);
