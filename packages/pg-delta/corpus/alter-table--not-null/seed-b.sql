-- name is NOT NULL in b.sql; email is nullable here but is re-added as NOT NULL
-- by the reverse migration to a.sql, so populate it too to preserve the row.
INSERT INTO test_schema.users (id, name, email) VALUES (1, 'Alice', 'alice@example.com');
