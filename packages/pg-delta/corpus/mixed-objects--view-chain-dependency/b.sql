CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text
);

CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY,
  user_id integer,
  amount numeric
);

-- View depending on both tables
CREATE VIEW test_schema.user_orders AS
  SELECT u.id, u.name, SUM(o.amount) AS total
  FROM test_schema.users u
  LEFT JOIN test_schema.orders o ON u.id = o.user_id
  GROUP BY u.id, u.name;

-- View depending on the first view
CREATE VIEW test_schema.top_users AS
  SELECT * FROM test_schema.user_orders
  WHERE total > 1000;
