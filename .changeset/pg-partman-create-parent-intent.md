---
"@supabase/pg-delta": minor
---

Capture and replay pg_partman parent registrations as extension intent (CLI-2044).

Registering a partitioned parent with pg_partman is not schema DDL —
`partman.create_parent(...)` is a function call that writes a row to partman's
own `part_config` registry and premakes the child partitions. Until now a
from-scratch declarative rebuild therefore produced a BARE
`PARTITION BY RANGE` parent: no registration, no children, no maintenance.

`pgPartmanHandler` now captures each `part_config` row as an `extensionIntent`
fact keyed by the catalog-canonical `<schema>.<table>` and replays it through
partman's own API — `select partman.create_parent(…)`, ordered after
`CREATE EXTENSION pg_partman` (a `depends` edge) and after the parent's
`CREATE TABLE` (a `consumes` edge). The eleven intent columns `create_parent`
has no argument for (retention, `optimize_constraint`,
`infinite_time_partitions`, …) replay as a follow-up `UPDATE part_config`,
emitted only when they differ from partman's own defaults, so they are neither
lost nor noisy. A database containing a configured parent now round-trips
through `schema export` → load into a fresh shadow → re-extract with an empty
diff and an identical `part_config` row.

The full `part_config` column disposition — which of the 29 columns are intent
reachable from a `create_parent` argument, intent settable only by updating
`part_config`, or pure runtime state — is documented in the handler header and
in `docs/architecture/extension-intent.md` §3.3.1, audited against pg_partman
5.3.1.

Deliberate scope, each recorded in `docs/roadmap/pg-delta-next-follow-ups.md`:
removing a registration DEREGISTERS it (`DELETE FROM part_config`,
`dataLoss: "none"`) and destroys no partition — `undo_partition()` needs a
separate target table and is loop-batched, so it is not renderable as a replay —
which leaves the orphaned partitions for an explicit second sync round.
Sub-partitioned sets (`create_sub_parent`) emit the `intent-unsupported` warning
instead of a fact that could never converge. Phase A is unchanged: every
partition at every level stays tagged `managedBy`, so nothing ever plans a
`DROP TABLE` against them, and partman's auto-created template table is now
tagged too.

Note for existing callers passing `pgPartmanHandler` to `extract()` and then
driving `plan()` directly: the handler now emits intent facts, and `plan()`
must be given their replay rules or the rule resolver throws rather than
silently dropping declared intent. The supported way to obtain them is a
profile: wrap the handlers in an `IntegrationProfile`
(`{ id, handlers: [pgPartmanHandler, …] }`), call `resolveProfile(profile)`,
and spread the returned `planOptions` (which carries `intentRules`) into
`plan()` — hand-assembling the recipe without a profile is not a supported
composition.
