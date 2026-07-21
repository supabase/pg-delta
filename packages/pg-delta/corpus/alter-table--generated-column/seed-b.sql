-- calculations intentionally NOT seeded (mutating generated expression flips the
-- data-proof fingerprint; see seed.sql note). users has no generated column in a.sql,
-- so seeding it here is safe in both directions.
INSERT INTO test_schema.users (id, first_name, last_name) VALUES (1, 'Jane', 'Doe');
