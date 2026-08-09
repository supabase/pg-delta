CREATE ROLE corpus_policy_reader_new NOLOGIN;
ALTER ROLE corpus_policy_reader_new SET statement_timeout = '314159ms';

CREATE SCHEMA app;
CREATE TABLE app.docs (id integer);
ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_read ON app.docs
  FOR SELECT TO corpus_policy_reader_new USING (true);
