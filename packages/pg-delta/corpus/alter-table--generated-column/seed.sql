-- calculations is intentionally NOT seeded: its `computed` generated column keeps
-- the same column shape but changes expression (value_a+value_b -> value_a*value_b),
-- so the stored generated value legitimately changes (5 -> 6). The data-preservation
-- proof fingerprints that as a content change even though the real columns
-- (value_a, value_b) are preserved. Left allowlisted (23502) instead. See report.
INSERT INTO test_schema.users (id, first_name, last_name) VALUES (1, 'Jane', 'Doe');
