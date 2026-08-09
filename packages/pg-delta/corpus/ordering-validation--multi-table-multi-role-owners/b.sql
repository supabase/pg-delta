-- state B: multiple roles, multiple tables across schemas, each table owned by different role
CREATE ROLE app_admin LOGIN;
CREATE ROLE analytics_user LOGIN;
CREATE SCHEMA app_schema;
CREATE SCHEMA analytics_schema;
CREATE TABLE app_schema.users (
  id integer PRIMARY KEY,
  email text UNIQUE
);
CREATE TABLE app_schema.orders (
  id integer PRIMARY KEY,
  user_id integer,
  amount decimal
);
CREATE TABLE analytics_schema.reports (
  id integer PRIMARY KEY,
  data jsonb
);
ALTER TABLE app_schema.users OWNER TO app_admin;
ALTER TABLE app_schema.orders OWNER TO app_admin;
ALTER TABLE analytics_schema.reports OWNER TO analytics_user;
