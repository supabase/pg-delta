---
"@supabase/pg-delta-next": patch
---

Harden the shadow loader's non-transactional fallback. On SQLSTATE 25001,
`applyFile` re-ran the statement raw, outside the per-file transaction that
confines the load to the throwaway shadow database — so on a co-located shadow
(which shares the target's live cluster) a non-transactional cluster-global
statement (`ALTER SYSTEM`, `CREATE/DROP DATABASE`, `CREATE/DROP TABLESPACE`), or
a `CREATE SUBSCRIPTION` opening a live replication connection, could execute
against the customer's cluster and persist after the shadow was dropped. The raw
fallback is now restricted to an allowlist of one — `CREATE INDEX CONCURRENTLY`,
the only non-transactional statement a declarative schema legitimately contains;
every other 25001-raiser is refused with a `ShadowLoadError`
(`unsupported_non_transactional`). Deterministic policy refusals from the loader
now surface immediately instead of being retried until the round budget is
exhausted.
