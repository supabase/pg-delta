-- seed ensures no NULLs in name so SET NOT NULL succeeds
INSERT INTO test_schema.users (id, name, email) VALUES (1, 'Alice', 'alice@example.com');
