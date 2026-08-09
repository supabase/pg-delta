CREATE SCHEMA pub_test;
CREATE TABLE pub_test.logs (id SERIAL PRIMARY KEY, payload JSONB);
CREATE PUBLICATION pub_opts FOR TABLE pub_test.logs WITH (
  publish = 'insert, update',
  publish_via_partition_root = true
);
