---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): export/apply/drift round-trip fidelity — prune stale files, isolated shadow, drift redaction mode

- `schema export` now removes stale `.sql` files from a previous export before
  writing. Previously a re-export into a populated `--out-dir` only overwrote the
  new paths, so a dropped object's file lingered and `schema apply --dir` would
  reload it, reintroducing the dropped object/grants. Only managed `.sql` files
  not in the new set are removed; non-SQL files are never touched.
- `schema apply` gains `--isolated-shadow`, which loads the declarative files with
  `mode: "isolatedCluster"`. A directory carrying cluster-level role state
  (`cluster/roles.sql`: `CREATE ROLE`, membership grants) otherwise trips the
  default `databaseScratch` shared-object leak guard and cannot be reloaded even
  when the operator supplies a dedicated shadow cluster.
- `snapshot` now records its redaction mode in the snapshot file (metadata only —
  it never affects the digest), and `drift` re-extracts the live environment with
  that same mode. A snapshot saved with `--unsafe-show-secrets` no longer reports
  spurious placeholder-vs-real drift for unchanged FDW/subscription secrets when
  the operator omits the flag on `drift`.
