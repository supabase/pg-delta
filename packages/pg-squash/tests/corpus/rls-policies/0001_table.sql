CREATE TABLE rls_docs (
  id int PRIMARY KEY,
  owner_id int NOT NULL,
  body text NOT NULL,
  published boolean NOT NULL DEFAULT false
);
