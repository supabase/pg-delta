CREATE INDEX blog_posts_author_idx ON blog.posts (author_id);
CREATE INDEX blog_comments_post_idx ON blog.comments (post_id);
