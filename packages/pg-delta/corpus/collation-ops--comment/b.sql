CREATE SCHEMA coll_schema;

CREATE COLLATION coll_schema.c2 (LC_COLLATE = 'C', LC_CTYPE = 'C');

COMMENT ON COLLATION coll_schema.c2 IS 'Test collation comment';
