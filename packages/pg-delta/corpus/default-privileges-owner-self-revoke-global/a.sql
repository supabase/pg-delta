-- state A: a GLOBAL (no IN SCHEMA) default-privileges row created purely by a
-- grant to ANOTHER role, which on a global row MATERIALIZES the owner's own
-- acldefault self-entry: {owner=arwdDxtm/owner, reader=r/owner}. The owner sits
-- at its built-in default (no fact) — only reader's SELECT is a customization.
CREATE ROLE corpus_adpg_owner NOLOGIN;
CREATE ROLE corpus_adpg_reader NOLOGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_adpg_owner
  GRANT SELECT ON TABLES TO corpus_adpg_reader;
