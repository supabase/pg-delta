CREATE TABLE rtf_orgs (org_id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE rtf_members (id int PRIMARY KEY, org_id int NOT NULL);
