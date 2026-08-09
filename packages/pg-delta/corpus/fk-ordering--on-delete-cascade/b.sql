-- FK updated to have ON DELETE CASCADE ON UPDATE CASCADE
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.users (
  id integer PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY,
  user_id integer NOT NULL,
  status text NOT NULL,
  CONSTRAINT orders_user_fkey
    FOREIGN KEY (user_id) REFERENCES test_schema.users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
