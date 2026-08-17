CREATE TABLE blog.posts (
  id int PRIMARY KEY,
  author_id int NOT NULL REFERENCES blog.authors (id),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL DEFAULT ''
);
