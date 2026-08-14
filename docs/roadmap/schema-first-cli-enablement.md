# Schema-first CLI enablement

- **Status**: V1 engine slices implemented; WP2, WP3c, and WP3d–f await
  merge. WP5 is not a V1 blocker; WP6 stays deferred.
- **Date**: 2026-08-14
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
  true` makes it fatal. Named `LoadSqlFilesOptions` is exported; the library
  default stays permissive (WP4, #419).
- Coverage diagnostics: `unmodeled_kind`, `unmodeled_drift`,
  `unresolved_security_label`.
- `planSchemaFiles()` — load + extract + plan + coverage-drift probe.
- `serializeSnapshot` / `deserializeSnapshot` / `saveSnapshot` /
  `loadSnapshot` — version-stamped, fail-closed.
- `_custom/` preservation (exporter never writes/prunes/claims it) and
  `ExportManifest.files` ownership list.
- Required `Plan.planId` (WP1, #418) — SHA-256 over format/engine version,
  source/target fingerprints, preamble, accepted renames, the ordered action
  list, and profile/scope/policy. `parsePlan` and `apply()` refuse a missing
  or mismatching digest (`re-plan`).
- `classifySqlFiles` / `classifySqlContent` (WP3a, #414).
- `pruneStaleSqlFiles`, `renderApplyScript`, `probeUnmodeledIdentitiesPinned`
  (WP3b, #416).

**Inventory corrections vs the RFC text:**

- Plan artifacts already stamp `formatVersion` + `engineVersion`; `parsePlan`
  and `apply()` refuse a mismatch. WP1 (`Plan.planId`) shipped in #418.
- `segmentActions()` is exported from `@supabase/pg-delta/apply`. WP3c adds
  the `Segment` type and `planSegments(plan)` on the root/`frontends` barrels
  (implemented, awaiting merge). `renderApplyScript` shipped in WP3b (#416).

---

## WP1 — ✅ Stable plan identifier — shipped (#418)

`Plan.planId` is a required SHA-256 content hash over `formatVersion`,
`engineVersion`, source/target fingerprints, the `preamble` (executed per
segment by apply — run content, like the action list), `acceptedRenames`,
the ordered action list, and `profile`/`scope`/`policy`. `plan()` stamps it via
`stampPlanId`; `parsePlan` and `apply()` refuse a missing or mismatching
digest (`re-plan` — never silently upgrade). Version fail-closed for
`formatVersion`/`engineVersion` was already in place. Stale artifacts
without `planId` must be re-planned.

---

## WP2 — 🟠 Hazard classification 2.0 — implemented, awaiting merge

Branch: `avallete/pg-delta-wp2-hazard-classification`.

`actionHazards` / `classifyPlanHazards` derive stable `HazardKind` codes from
existing proof-verified safety fields plus coverage diagnostics. Kinds are a
view — they are not stored on `Plan`/`Action` and are not part of `planId`.
Policy (which hazards block which target class) stays in the Supabase CLI.
Linear: CLI-1459–1464.

Per-action: `data_loss`, `rewrite_risk`, `non_transactional`,
`access_exclusive_lock`. Plan-level coverage: `unmodeled_kind`,
`unmodeled_drift`, `unresolved_security_label`.

---

## WP3 — 🟡 Promote CLI-only logic into exported library frontends

Library frontends accept pools and SQL files; they return typed data. No
`supabase/` paths, prompts, or CLI JSON. `pgdelta` stays a thin consumer.

| Slice | Status | Notes |
|---|---|---|
| **WP3a** export file classification | shipped (#414) | Pure `classifySqlFiles` / `classifySqlContent`. Does **not** export `writeExportFiles` (writes, scaffolds `_custom/README.md`, refuses unmanaged). |
| **WP3b** prune / apply-script / unmodeled-drift | shipped (#416) | `pruneStaleSqlFiles`, `renderApplyScript`, `probeUnmodeledIdentitiesPinned`. |
| **WP3c** `Segment` + `planSegments` | implemented, awaiting merge | Branch `avallete/pg-delta-wp3c-plan-segments`. Also re-exports `segmentActions` from root/`frontends`. |
| **WP3d** coverage gate | implemented, awaiting merge | Branch `avallete/pg-delta-wp3def-frontend-helpers`. `STRICT_COVERAGE_CODES` + `hasBlockingDiagnostics` in a frontend; `printDiagnostics` / `exitIfBlocking` stay in the CLI. |
| **WP3e** data-loss listing | implemented, awaiting merge | Same branch as WP3d. `dataLossActions` in a frontend; `assertDataLossAllowed` stays in the CLI. |
| **WP3f** database identity | implemented, awaiting merge | Same branch as WP3d. `SourceDatabaseIdentity` + `src/database-identity.ts` helpers (not URL parsing). |

---

## WP4 — ✅ Loader contract polish — shipped (#419)

Named and exported `LoadSqlFilesOptions`. Library default for
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

Shipped on `main`: WP3a (#414), WP3b (#416), WP1 (#418), WP4 (#419). The
remaining V1 slices (WP3c, WP2, WP3d–f) were implemented in parallel and
await merge; they do not depend on each other.

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
