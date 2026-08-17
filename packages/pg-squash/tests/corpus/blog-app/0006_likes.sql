CREATE TABLE blog.likes (
  post_id int NOT NULL REFERENCES blog.posts (id) ON DELETE CASCADE,
  author_id int NOT NULL REFERENCES blog.authors (id),
  PRIMARY KEY (post_id, author_id)
);
