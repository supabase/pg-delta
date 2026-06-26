CREATE SCHEMA inventory;

CREATE TYPE inventory.address AS (
  street TEXT,
  city TEXT,
  zip_code TEXT
);

CREATE TABLE inventory.warehouses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location inventory.address
);

CREATE MATERIALIZED VIEW inventory.warehouse_locations AS
SELECT
  name,
  (location).city as city,
  (location).zip_code as zip_code
FROM inventory.warehouses
WHERE (location).city IS NOT NULL;
