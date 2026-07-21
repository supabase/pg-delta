-- (2, 2) is a fixed point of both generation expressions (2 + 2 = 2 * 2 = 4), so
-- the stored `computed` value is identical before and after the expression change
-- and the data-proof fingerprint holds — while value_a / value_b (the real user
-- data) gain fingerprint protection. If you change either expression, pick a new
-- fixed point. OMIT `computed`: GENERATED ALWAYS rejects explicit inserts.
INSERT INTO test_schema.calculations (id, value_a, value_b) VALUES (1, 2, 2);
INSERT INTO test_schema.users (id, first_name, last_name) VALUES (1, 'Jane', 'Doe');
