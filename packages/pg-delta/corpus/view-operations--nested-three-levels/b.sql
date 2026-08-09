CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer,
  name text,
  email text,
  created_at timestamp DEFAULT NOW()
);

CREATE TABLE test_schema.orders (
  id integer,
  user_id integer,
  amount decimal(10,2),
  created_at timestamp DEFAULT NOW()
);

-- Level 1: Views directly on tables
CREATE VIEW test_schema.recent_users AS
SELECT id, name, email, created_at
FROM test_schema.users
WHERE created_at > NOW() - INTERVAL '30 days';

CREATE VIEW test_schema.high_value_orders AS
SELECT id, user_id, amount, created_at
FROM test_schema.orders
WHERE amount > 100;

-- Level 2: View on level-1 views
CREATE VIEW test_schema.recent_big_spenders AS
SELECT u.id, u.name, u.email, COUNT(o.id) AS order_count, SUM(o.amount) AS total_spent
FROM test_schema.recent_users u
JOIN test_schema.high_value_orders o ON u.id = o.user_id
GROUP BY u.id, u.name, u.email;

-- Level 3: View on level-2 view
CREATE VIEW test_schema.top_customers AS
SELECT id, name, email, total_spent
FROM test_schema.recent_big_spenders
WHERE total_spent > 1000
ORDER BY total_spent DESC
LIMIT 10;
