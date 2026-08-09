-- one table in each of two distinct schemas
CREATE SCHEMA schema_a;
CREATE SCHEMA schema_b;

CREATE TABLE schema_a.table_a (
  id integer,
  name text
);

CREATE TABLE schema_b.table_b (
  id integer,
  description text
);
