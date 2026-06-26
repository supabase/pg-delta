CREATE SCHEMA analytics;
CREATE TYPE analytics.status AS ENUM ('active', 'inactive', 'pending');
CREATE TABLE analytics.users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status analytics.status DEFAULT 'pending'
);
CREATE MATERIALIZED VIEW analytics.user_status_summary AS
SELECT status, COUNT(*) as count
FROM analytics.users
GROUP BY status;
