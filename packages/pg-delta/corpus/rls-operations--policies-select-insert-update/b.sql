CREATE SCHEMA forum;
CREATE TABLE forum.messages (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE forum.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_messages ON forum.messages
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY insert_own_messages ON forum.messages
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY update_own_messages ON forum.messages
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);
