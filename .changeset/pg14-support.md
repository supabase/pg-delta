---
"@supabase/pg-delta": minor
---

Add PostgreSQL 14 support. Catalog extraction now guards the PG15+-only catalog columns and relations that previously errored on PG14: `pg_index.indnullsnotdistinct` (NULLS NOT DISTINCT), `pg_subscription.subtwophasestate`/`subdisableonerr` (two-phase / disable-on-error), `pg_collation.colliculocale` (ICU locale), `pg_publication_rel.prattrs`/`prqual` (column lists / row filters), and the `pg_publication_namespace` catalog (schema-level publications). A dedicated empty-catalog baseline is shipped for PG14, whose default `public` schema ACL/owner differs from PG15+.
