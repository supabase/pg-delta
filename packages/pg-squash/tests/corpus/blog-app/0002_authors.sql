CREATE TABLE blog.authors (
  id int PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  display text NOT NULL
);
