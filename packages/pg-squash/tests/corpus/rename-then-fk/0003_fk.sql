ALTER TABLE rtf_members
  ADD CONSTRAINT rtf_members_org_fk FOREIGN KEY (org_id) REFERENCES rtf_orgs (id);
