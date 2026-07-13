-- state B: an ADP row that physically contains the grantor's OWN self-entry with
-- privileges EQUAL to acldefault (materialized by an explicit
-- `GRANT ALL ON TABLES TO <owner>`), alongside a grant to another role. The
-- stored row is {owner=arwdDxtm/owner, reader=r/owner}. A replayed DB only ever
-- materializes {reader=r/owner} (no self-entry) — a behaviorally identical row —
-- so extraction must treat owner-present-at-default and owner-absent as the SAME
-- state, or re-export emits a spurious `revoke all on tables ... from <owner>`.
CREATE ROLE corpus_adp_owner NOLOGIN;
CREATE ROLE corpus_adp_reader NOLOGIN;
CREATE SCHEMA corpus_adp AUTHORIZATION corpus_adp_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_adp_owner IN SCHEMA corpus_adp
  GRANT ALL ON TABLES TO corpus_adp_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_adp_owner IN SCHEMA corpus_adp
  GRANT SELECT ON TABLES TO corpus_adp_reader;
