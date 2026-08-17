ALTER TABLE blog.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY blog_comments_read ON blog.comments FOR SELECT USING (true);
