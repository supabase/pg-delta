---
"@supabase/pg-delta": patch
---

Three fixes to the SQL loader, snapshot metadata, and baseline subtraction:

- **Loader:** `CREATE|ALTER|DROP USER MAPPING …` statements are no longer misclassified as cluster-global role DDL. The role-lifecycle scanners now use a `user(?!\s+mapping)` negative lookahead, so database-scope `schema apply` accepts (and `--skip-cluster-ddl` no longer strips) the user mappings pg-delta itself emits in foreign-data exports.
- **Snapshots:** `pgdelta snapshot` now stamps the profile it was captured under (a declared id, `null` for a raw capture, or absent for pre-feature legacy snapshots — never folded into the digest). `drift` and `prove` reconcile that stamp against any `--profile` flag: an omitted flag adopts the stamped profile, a contradicting flag fails closed with an actionable error, and a legacy (un-stamped) snapshot keeps the previous behavior with a one-line note.
- **Baseline subtraction:** `subtractBaseline` now compares each fact's outgoing-edge signature alongside its payload hash, so an equal-payload fact whose ownership/provenance edge changed (e.g. `OWNER` A→B) is no longer subtracted and pruned away invisibly. Owner→role edges to subtracted platform roles are retained as dangling assumed references so ownership still serializes.
