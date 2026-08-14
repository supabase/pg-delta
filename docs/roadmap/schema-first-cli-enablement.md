# Schema-first CLI enablement

- **Status**: Shipped — every V1 work package has landed. Remaining items
  are WP5 (not V1) and WP6 (deferred).
- **Date**: 2026-08-13 (status refresh 2026-08-14)
- **Source**: RFC *Schema-First Database Development* (Linear
  `rfc-schema-first-database-development-532de5a122d5`, 2026-08-12, **revised
  2026-08-13**).

What `@supabase/pg-delta` exports so the Supabase CLI can build the
schema-first workflow (`schema pull / diff / generate / apply / push`).
pg-delta is the schema compiler; the CLI owns the workflow layer.

The 2026-08-13 revision: `schema extract` → `schema pull` (V1), `--replace` →
`--force`, semantic reconciliation dropped for the `_custom/` escape hatch,
checkpoint records the extracted catalog snapshot as a forward-compatible
base. Observed provenance (WP6) is deferred.

| Symbol | Meaning |
|---|---|
| ✅ | Shipped / already provided by the engine |
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

---

## WP1 — ✅ Stable plan identifier (#418)

`Plan.planId` is a required SHA-256 content hash over `formatVersion`,
`engineVersion`, source/target fingerprints, `preamble`, `acceptedRenames`,
the ordered action list, and `profile`/`scope`/`policy`. `plan()` stamps it
via `stampPlanId`; `parsePlan` and `apply()` refuse a missing or mismatching
digest (`re-plan` — never silently upgrade).

---

## WP2 — ✅ Hazard classification 2.0 (#420)

`actionHazards` / `classifyPlanHazards` export stable `HazardKind` codes
derived from proof-verified action safety fields (`dataLoss`, `rewriteRisk`,
`transactionality`, `lockClass`) and coverage diagnostics. Hazard kinds are
a **view** — they are not stored on `Plan`/`Action` and are not part of
`planId`. Policy (which hazards block which target class) stays in the
Supabase CLI. Linear: CLI-1459–1464.

The original backlog also named a `pgdelta --allow-hazards` gate and a
GitLab Code-Quality JSON reporter. Those remain optional `pgdelta` CLI DX;
the RFC adapter classifies via the library and applies policy itself.

---

## WP3 — ✅ Promote CLI-only logic into exported library frontends

Library frontends accept pools and SQL files; they return typed data. No
`supabase/` paths, prompts, or CLI JSON. `pgdelta` stays a thin consumer.

| Slice | Status | Notes |
|---|---|---|
| **WP3a** export file classification | ✅ #414 | Pure `classifySqlFiles` / `classifySqlContent`. Does **not** export `writeExportFiles`. |
| **WP3b** prune / dry-run / unmodeled probe | ✅ #416 | `pruneStaleSqlFiles`, `renderApplyScript`, `probeUnmodeledIdentitiesPinned`. |
| **WP3c** segments | ✅ #421 | `Segment` + `planSegments(plan)` from root/`frontends`. |
| **WP3d** strict-coverage gate | ✅ #423 | `STRICT_COVERAGE_CODES` + `hasBlockingDiagnostics`. `printDiagnostics` / `exitIfBlocking` stay in the CLI. |
| **WP3e** data-loss helpers | ✅ #423 | `dataLossActions`. `assertDataLossAllowed` stays in the CLI. |
| **WP3f** target-identity safety | ✅ #423 | `SourceDatabaseIdentity` + `database-identity.ts` helpers (not URL parsing). |

---

## WP4 — ✅ Loader contract polish (#419)

`LoadSqlFilesOptions` is a named, exported type. The library default for
`strictDataStatements` stays permissive (warning); the Supabase CLI adapter
**must** pass `strictDataStatements: true`.

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

## RFC phase mapping (pg-delta side)

| RFC phase | pg-delta |
|---|---|
| Phase 0 — strengthen current declarative workflow | ✅ WP2 + WP3d |
| Phase 1 — `schema pull` / `diff` / `generate` | ✅ WP1 + WP3a–c |
| Phase 2 — `schema apply` + draft journal | ✅ `apply()` plus WP1 `planId` and WP2 hazard codes |
| Phase 3–4 — `schema push` / top-level composition | Nothing new on the pg-delta side |
| Phase 5 — stronger verification | WP5 tracks |

The remaining work is the **Supabase CLI adapter**: staging, `--force`,
unmanaged-file policy, checkpoints, draft journals, and hazard *policy*.

---

## Boundary (binding)

- pg-delta does not learn about `supabase/database`, `supabase/migrations`,
  linked projects, branch protection, prompts, or CLI JSON.
- The Supabase CLI owns staging, `--force`, unmanaged-file /
  `--prune-unmanaged` policy, install/recovery, target/branch policy,
  checkpoints, draft journals, and migration history.
- pg-delta owns classification, planning, safety metadata, rendering,
  fingerprints, apply, and proof.
- Persisted plan artifacts are diagnostic and version-bound; stale artifacts
  are re-planned, never silently upgraded.
