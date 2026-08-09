CREATE SCHEMA test_schema;

CREATE TABLE test_schema.orders (
  id serial PRIMARY KEY,
  customer text NOT NULL,
  total numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE MATERIALIZED VIEW test_schema.order_summary AS
  SELECT customer,
         sum(total) AS total_spent,
         count(*) AS order_count,
         max(created_at) AS last_order
  FROM test_schema.orders
  GROUP BY customer;

CREATE UNIQUE INDEX order_summary_customer_idx
  ON test_schema.order_summary (customer);

CREATE VIEW test_schema.top_customers AS
  SELECT * FROM test_schema.order_summary
  WHERE total_spent > 1000;
