-- state B: the SAME global row with the owner's self-entry REVOKED while the
-- grant to reader remains: {reader=r/owner}. On a GLOBAL row Postgres uses the
-- stored acl VERBATIM at object creation, so a table later made by the owner
-- really lacks the owner's own privileges — a genuine customization (unlike a
-- per-schema row, where the owner is always re-merged at CREATE). It must
-- round-trip as an owner REVOKE forward, and as an owner GRANT restoring the
-- built-in default in reverse.
CREATE ROLE corpus_adpg_owner NOLOGIN;
CREATE ROLE corpus_adpg_reader NOLOGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_adpg_owner
  REVOKE ALL ON TABLES FROM corpus_adpg_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_adpg_owner
  GRANT SELECT ON TABLES TO corpus_adpg_reader;
