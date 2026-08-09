---
"@supabase/pg-delta": patch
---

Three correctness fixes to schema diffing:

- **Sequence/identity `RESTART` only on disjoint ranges.** A combined
  `ALTER SEQUENCE` / `ALTER COLUMN … SET` that moved a bound and the START
  together appended `RESTART` unconditionally, resetting the live counter even
  when the new range still contained it (e.g. a sequence at 500 with
  `MINVALUE 1→0` + `START 1→2`) — replaying already-issued values and risking
  duplicate keys. `RESTART` is now emitted only when the old and new ranges are
  provably DISJOINT (the counter is then guaranteed invalid); an overlapping
  change leaves the unmodeled runtime counter alone, and if it happens to fall
  outside the new range PostgreSQL rejects the ALTER loudly rather than silently
  resetting.

- **Security labels on unmodeled `pg_type` kinds no longer mis-resolve.** The
  `pg_type` label resolver mapped every non-domain row to a `type` fact, but
  extraction only models enums, standalone composites, and ranges. A label on a
  base type, shell type, or a table's row type therefore attached to a
  nonexistent parent (dropped as an `orphaned_satellite` at severity `info`,
  slipping past `--strict-coverage`). Such labels now fall through to the
  `unresolved_security_label` diagnostic like other unmanaged targets.

- **Invalid indexes no longer converge against valid ones.** A failed or
  cancelled `CREATE INDEX CONCURRENTLY` leaves `indisvalid=false` with a def
  identical to the desired valid index, so the unusable index hashed EQUAL and
  planning saw zero drift. `indisvalid` is now a semantic payload field, so an
  invalid regular index differs from a valid one and is repaired via drop +
  recreate. Partitioned parent indexes (relkind `'I'`) are forced valid because
  their `indisvalid` tracks unmodeled child attach-state (#332), not corruption.
