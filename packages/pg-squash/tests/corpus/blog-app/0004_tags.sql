CREATE TABLE blog.tags (
  id int PRIMARY KEY,
  slug text NOT NULL UNIQUE
);
CREATE TABLE blog.post_tags (
  post_id int NOT NULL REFERENCES blog.posts (id) ON DELETE CASCADE,
  tag_id int NOT NULL REFERENCES blog.tags (id),
  PRIMARY KEY (post_id, tag_id)
);
