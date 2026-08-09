-- b.sql adds CHECK ("my-field" IS NOT NULL); populate it so the forward
-- migration's constraint validates against the seeded row.
INSERT INTO "my-schema"."my-table" (id, "my-field") VALUES (1, 'x');
