-- seed data to verify data survival across the column type change
INSERT INTO test_schema.items (id, state) VALUES (1, 'active'), (2, 'inactive');
