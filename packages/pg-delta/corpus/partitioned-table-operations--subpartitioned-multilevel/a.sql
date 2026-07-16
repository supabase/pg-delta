-- 3-level partitioning: only the root exists here. The forward diff must
-- create the middle layer (itself PARTITION BY RANGE) and the leaf under it,
-- exercising the subpartitioned-partition create path.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (
  id integer NOT NULL,
  region text NOT NULL,
  created_on date NOT NULL
) PARTITION BY LIST (region);
