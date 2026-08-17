CREATE TABLE fr_rows (
  id int PRIMARY KEY,
  n int NOT NULL,
  label text GENERATED ALWAYS AS (fr_label(n)) STORED
);
