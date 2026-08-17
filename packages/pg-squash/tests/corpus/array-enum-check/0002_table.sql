CREATE TABLE aec_flags (
  id int PRIMARY KEY,
  color aec_color NOT NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[]
);
