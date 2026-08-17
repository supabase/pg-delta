INSERT INTO pair_t (id, a, b, created_at)
SELECT
  i,
  i,
  CASE
    WHEN current_setting('app.swap', true) = 'on' THEN 3 - i
    ELSE i
  END,
  clock_timestamp()
FROM generate_series(1, 2) AS i;
