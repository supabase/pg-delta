---
"@supabase/pg-delta": patch
---

Fix four correctness/fidelity bugs:

- **Sequence & identity bounds now apply atomically.** Moving more than one
  sequence option in a single diff (e.g. `MINVALUE 100 MAXVALUE 200` →
  `MINVALUE 1 MAXVALUE 50`) emitted one `ALTER SEQUENCE`/`ALTER COLUMN`
  statement per field, so a transient `MAXVALUE 50` ran while `MINVALUE` was
  still 100 and Postgres rejected the intermediate range. Both seams now emit a
  single combined statement that validates the final state, and realign the
  backing sequence's counter (`RESTART`) when the range moves entirely off the
  old start.
- **`orderForShadow` no longer silently drops unparseable input.** When
  `@supabase/pg-topo` cannot parse a statement it returns an empty statement
  list, so the offending file vanished from the reordered output and a library
  caller built an incomplete desired state. The convenience API now throws a
  descriptive `ReorderParseError` instead (callers wanting graceful
  degrade-to-raw use `analyzeForShadow` and inspect its diagnostics).
- **ACL privileges are de-duplicated across grantors.** `aclexplode()` emits one
  row per grantor, so the same privilege granted to a grantee by two grantors
  was recorded twice and rendered `GRANT SELECT, SELECT …`, which Postgres
  collapses on apply — breaking re-extract convergence.
- **A security label on a view/matview column no longer crashes extraction.**
  View columns produce no column facts, so a label on one was parented on a
  missing fact and threw. Such labels are now reported via an
  `unresolved_security_label` diagnostic (strict mode blocks, default warns).
