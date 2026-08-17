CREATE POLICY rls_docs_select ON rls_docs
  FOR SELECT USING (published OR owner_id = 1);
