CREATE TABLE blog.comments (
  id int PRIMARY KEY,
  post_id int NOT NULL REFERENCES blog.posts (id) ON DELETE CASCADE,
  author_id int NOT NULL REFERENCES blog.authors (id),
  body text NOT NULL
);
