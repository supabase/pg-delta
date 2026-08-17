CREATE POLICY rls_docs_insert ON rls_docs
  FOR INSERT WITH CHECK (owner_id = 1);
CREATE POLICY rls_docs_update ON rls_docs
  FOR UPDATE USING (owner_id = 1) WITH CHECK (owner_id = 1);
