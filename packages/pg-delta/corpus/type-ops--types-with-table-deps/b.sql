CREATE SCHEMA test_schema;

-- Enum type used by a table column
CREATE TYPE test_schema.user_status AS ENUM ('active', 'inactive', 'pending');

-- Domain type used by a table column
CREATE DOMAIN test_schema.email AS TEXT CHECK (VALUE ~ '^[^@]+@[^@]+\.[^@]+$');

-- Composite type used by a table column
CREATE TYPE test_schema.address AS (
  street TEXT,
  city TEXT,
  zip_code TEXT
);

CREATE TABLE test_schema.users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status test_schema.user_status DEFAULT 'pending',
  email_address test_schema.email
);

CREATE TABLE test_schema.customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  billing_address test_schema.address,
  shipping_address test_schema.address
);
