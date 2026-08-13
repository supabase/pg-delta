# Schema-first CLI enablement

- **Status**: In progress — WP3a shipping; remaining WPs sequenced below.
- **Date**: 2026-08-13
- **Source**: RFC *Schema-First Database Development* (Linear
  `rfc-schema-first-database-development-532de5a122d5`, 2026-08-12, **revised
  2026-08-13**).

What `@supabase/pg-delta` must add so the Supabase CLI can build the
schema-first workflow (`schema pull / diff / generate / apply / push`).
pg-delta is the schema compiler; the CLI owns the workflow layer.

The 2026-08-13 revision: `schema extract` → `schema pull` (V1), `--replace` →
`--force`, semantic reconciliation dropped for the `_custom/` escape hatch,
checkpoint records the extracted catalog snapshot as a forward-compatible
base. Observed provenance (WP6) is deferred.

| Symbol | Meaning |
|---|---|
| ✅ | Already provided by the engine |
| 🟠 | Net-new engineering |
| 🟡 | Substrate exists; build the consumer/surface |
| ⚪ | Deliberate deferral |

---

## Already provided ✅

No new engine work — these must survive the CLI adapter without being
flattened to rendered SQL:

- Typed `Plan.actions` with `sql`, `verb`, dependency edges, `dataLoss`,
  `rewriteRisk`, `lockClass`, `transactionality`, plus `SafetyReport`.
- `Plan.source.fingerprint` / `Plan.target.fingerprint`.
- `Plan.renameCandidates`, `PlanOptions.renames`, `acceptRenames`.
- Fingerprint-gated `apply()` with `ApplyReport.actionStatuses` and
  `ApplyEvent` streaming.
- `renderPlanFiles()` — one logical change, multiple physical files at
  transaction boundaries.
- `loadSqlFiles()` DML detection (`data_statement`); `strictDataStatements:
  true` makes it fatal.
- Coverage diagnostics: `unmodeled_kind`, `unmodeled_drift`,
  `unresolved_security_label`.
- `planSchemaFiles()` — load + extract + plan + coverage-drift probe.
- `serializeSnapshot` / `deserializeSnapshot` / `saveSnapshot` /
  `loadSnapshot` — version-stamped, fail-closed.
- `_custom/` preservation (exporter never writes/prunes/claims it) and
  `ExportManifest.files` ownership list.

**Inventory corrections vs the RFC text:**

- Plan artifacts already stamp `formatVersion` + `engineVersion`; `parsePlan`
  and `apply()` refuse a mismatch. WP1's remaining work is `Plan.planId`.
- `segmentActions()` is already exported from `@supabase/pg-delta/apply`. WP3
  still needs the `Segment` type, a `planSegments(plan)` helper, and
  root/`frontends` re-exports, plus `renderApplyScript`.

---

## WP1 — 🟠 Stable plan identifier

Add `Plan.planId`: a content hash over source fingerprint, desired
fingerprint, accepted renames, an action-list digest, profile/scope/policy,
and engine + artifact format version. `parsePlan` verifies it. Version
fail-closed is already there.

---

## WP2 — 🟡 Hazard classification 2.0

Derive per-action `HazardKind[]` from existing proof-verified safety fields
plus coverage diagnostics. Export stable codes and a plan-level hazard
report. Policy (which hazards block which target class) stays in the
Supabase CLI. Linear: CLI-1459–1464.

---

## WP3 — 🟡 Promote CLI-only logic into exported library frontends

Library frontends accept pools and SQL files; they return typed data. No
`supabase/` paths, prompts, or CLI JSON. `pgdelta` stays a thin consumer.

| Slice | Status | Notes |
|---|---|---|
| **WP3a** export file classification | **this change** | Pure `classifySqlFiles` / `classifySqlContent`. Does **not** export `writeExportFiles` (writes, scaffolds `_custom/README.md`, refuses unmanaged). |
| **WP3b** | next | Re-export `pruneStaleSqlFiles`, `renderApplyScript`, `probeUnmodeledIdentitiesPinned`. |
| **WP3c** | | Export `Segment` + `planSegments(plan)` from root/`frontends`. |
| **WP3d** | | Move `STRICT_COVERAGE_CODES` + `hasBlockingDiagnostics` into a frontend; leave `printDiagnostics` / `exitIfBlocking` in the CLI. |
| **WP3e** | | Move `dataLossActions` into a frontend; leave `assertDataLossAllowed` in the CLI. |
| **WP3f** | | Export `SourceDatabaseIdentity` + `src/database-identity.ts` helpers (not URL parsing). |

---

## WP4 — 🟠 Loader contract polish

Name and export `LoadSqlFilesOptions`. Library default for
`strictDataStatements` stays permissive (warning); the Supabase CLI adapter
**must** pass `strictDataStatements: true`. Flipping the library default is
a breaking change with no engine benefit.

---

## WP5 — Supporting tracks (not V1 blockers)

Extension-intent Phase B, Supabase baseline snapshots, ephemeral auto-shadow,
coverage waves / outside-observer verification. See [backlog.md](backlog.md).

---

## WP6 — ⚪ Observed provenance

Deferred. The RFC revision dropped semantic reconciliation; the checkpoint
catalog snapshot is the only forward-compatibility hook, and the engine
already provides it. Reopen only if an opt-in `schema pull --merge` is
designed, or if diff-UX demand justifies Tier 1 on its own.

---

## Sequencing

WP3a → WP3b/c (pull's file summary + segments) → WP1 → WP2 → WP3d/e/f → WP4.

RFC phase mapping: Phase 0 needs WP2 + WP3d; Phase 1 needs WP1 + WP3a–c;
Phase 2 consumes `planId` + hazard codes; Phases 3–4 need nothing new on
the pg-delta side.

---

## Boundary (binding on every WP)

- pg-delta does not learn about `supabase/database`, `supabase/migrations`,
  linked projects, branch protection, prompts, or CLI JSON.
- The Supabase CLI owns staging, `--force`, unmanaged-file /
  `--prune-unmanaged` policy, install/recovery, target/branch policy,
  checkpoints, draft journals, and migration history.
- pg-delta owns classification, planning, safety metadata, rendering,
  fingerprints, apply, and proof.
- Persisted plan artifacts are diagnostic and version-bound; stale artifacts
  are re-planned, never silently upgraded.
