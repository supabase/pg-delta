CREATE ROLE corpus_policy_reader_old NOLOGIN;
ALTER ROLE corpus_policy_reader_old SET statement_timeout = '314159ms';

CREATE SCHEMA app;
CREATE TABLE app.docs (id integer);
ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_read ON app.docs
  FOR SELECT TO corpus_policy_reader_old USING (true);
