CREATE TABLE squash_mv_src (id int PRIMARY KEY, n int NOT NULL);
INSERT INTO squash_mv_src VALUES (1, 10), (2, 20);
CREATE MATERIALIZED VIEW squash_mv AS SELECT n, count(*)::int AS c FROM squash_mv_src GROUP BY n;
CREATE UNIQUE INDEX squash_mv_n ON squash_mv (n);
