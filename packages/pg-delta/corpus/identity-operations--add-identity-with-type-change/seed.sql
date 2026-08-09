-- `id integer NOT NULL` has no default, so the proof loop's autoseed
-- (INSERT … DEFAULT VALUES) cannot seed this table — seed it explicitly so the
-- data-preservation proof has teeth in the FORWARD direction. The b-side
-- identity column accepts DEFAULT VALUES, so no seed-b.sql is needed.
INSERT INTO app.counters (id) VALUES (1);
