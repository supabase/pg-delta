-- base type change forces a domain REPLACE (drop + recreate); the inlined
-- CHECK must not also be recreated separately.
CREATE SCHEMA test_schema;
CREATE DOMAIN test_schema.d AS bigint CONSTRAINT d_check CHECK (VALUE > 0);
