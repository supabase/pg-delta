# API Review — `@supabase/pg-delta` public exports

Stage-9 deliverable 8. Every name exported from `src/index.ts` reviewed
name-by-name. Architecture vocabulary check: **facts** / **deltas** /
**actions** / **proof** columns indicate whether the name is grounded in
the documented vocabulary.

## Vocabulary key

| symbol | meaning |
|--------|---------|
| ✓ | name is clearly grounded in the arch vocabulary |
| ~ | grounded but indirectly (utility/supporting concept) |
| — | not applicable (e.g., error class, generic utility) |

---

## Core primitives

| Name | Kind | Contract | facts | deltas | actions | proof |
|------|------|----------|:-----:|:------:|:-------:|:-----:|
| `NotImplementedError` | class | Thrown by API stubs for not-yet-implemented stages. Safe to export; callers that import stubs need a concrete catch type. | — | — | — | — |
| `Diagnostic` | type | One shared structured-error shape used by every layer (extraction, loader, planner, apply). `{ code, severity, subject?, message, context? }` | ~ | ~ | ~ | ~ |
| `StableId` | type | Discriminated union of all addressable identity shapes (simple/qualified/sub-entity/routine/membership/…). The identity layer of facts. | ✓ | ✓ | ✓ | ✓ |
| `FactKind` | type | Union of all `StableId["kind"]` strings. Useful for narrowing/mapping. | ✓ | — | — | — |
| `encodeId` | function | `StableId → string` — the canonical string codec. Only place string encoding exists (guardrail 1). | ✓ | — | — | — |
| `parseId` | function | `string → StableId` — inverse of `encodeId`. | ✓ | — | — | — |
| `Payload` | type | `{ [key: string]: PayloadValue }` — the identity-free content of a fact. | ✓ | — | — | — |
| `ContentHash` | type | Opaque brand for a SHA-256 hex string produced by `contentHash`. | ✓ | — | — | — |
| `canonicalize` | function | Canonical deterministic JSON serialization of a `PayloadValue` — the equality surface of the whole system. | ✓ | — | — | — |
| `contentHash` | function | `PayloadValue → ContentHash` — SHA-256 of the canonical form. | ✓ | — | — | — |
| `Fact` | type | `{ id: StableId; parent?: StableId; payload: Payload }` — the atomic unit of schema knowledge. | ✓ | ✓ | ✓ | ✓ |
| `DependencyEdge` | type | `{ from, to: StableId; kind: EdgeKind }` — a directed dependency between two facts (tear-down / build-up order). | ✓ | ✓ | ✓ | — |
| `EdgeKind` | type | `"depends" \| "owner" \| "memberOfExtension" \| "managedBy"` — semantic type of a `DependencyEdge`. | ✓ | — | — | — |
| `FactBase` | class | Immutable, content-addressed collection of `Fact`s and `DependencyEdge`s. The canonical in-memory schema representation. | ✓ | ✓ | ✓ | ✓ |
| `buildFactBase` | function | Construct a `FactBase` from arrays of facts and edges. Entry point for test fixtures and snapshot deserialization. | ✓ | — | — | — |
| `serializeSnapshot` | function | `(FactBase, { pgVersion }) → string` — format-v1 bigint-safe JSON, includes digest. | ✓ | — | — | — |
| `deserializeSnapshot` | function | `string → { factBase: FactBase; pgVersion: string }` — verifies digest on load; throws on corruption. | ✓ | — | — | — |
| `Delta` | type | Tagged union: `add / remove / set / link / unlink` — one atomic change between two fact bases. The diff vocabulary. | — | ✓ | — | — |
| `diff` | function | `(a: FactBase, b: FactBase) → Delta[]` — rollup-guided, zero per-kind code, deterministically sorted. | — | ✓ | — | — |

---

## Extract

| Name | Kind | Contract | facts | deltas | actions | proof |
|------|------|----------|:-----:|:------:|:-------:|:-----:|
| `ExtractResult` | type | `{ factBase: FactBase; pgVersion: string; diagnostics: Diagnostic[] }` — everything `extract` returns. | ✓ | — | — | — |
| `extract` | function | `Pool → Promise<ExtractResult>` — single REPEATABLE READ snapshot of a live database into a `FactBase`. | ✓ | — | — | — |

---

## Plan

| Name | Kind | Contract | facts | deltas | actions | proof |
|------|------|----------|:-----:|:------:|:-------:|:-----:|
| `ENGINE_VERSION` | const | Current engine compatibility version stamped into plan artifacts; `apply` refuses artifacts from other engines. | — | — | ✓ | — |
| `Action` | type | One executable DDL statement with `sql`, `verb`, `produces/consumes/destroys/releases`, `transactionality`, `lockClass`, `dataLoss`, `rewriteRisk`. The unit the executor runs. | — | — | ✓ | ✓ |
| `Plan` | type | Complete planner artifact: actions, managed/filtered deltas, optional compatibility `projectionAudit?`, policy/profile/scope metadata, rename decisions, safety report, and source/target fingerprints. Newly produced plans carry the audit; optionality permits legacy v1 parsing. | ✓ | ✓ | ✓ | ✓ |
| `SafetyReport` | type | Aggregated per-plan counts: destructive, rewriteRisk, nonTransactional actions; lock class histogram. | — | — | ✓ | — |
| `PlanOptions` | type | `{ params?, policy?, baseline?, renames?, acceptRenames?, compact?, capability? }` — the complete option bag for `plan()`. `baseline?` is the resolved platform `FactBase` whose facts are subtracted before diffing; `capability?` is the `ApplierCapability` that projects out operations the applier cannot execute. | — | — | ✓ | — |
| `plan` | function | `(source, desired: FactBase, options?: PlanOptions) → Plan` — the planner: deltas × rule table → topologically sorted actions. | ✓ | ✓ | ✓ | — |
| `ProjectionAudit` | type | Complete attributed raw differences hidden by managed-view projection: ordered `entries` plus recomputed suspicious/acknowledged/baseline summary counts. | ✓ | ✓ | — | ✓ |
| `ProjectionAuditEntry` | type | One hidden `Delta`, its fact/edge subject, all source/desired suppression causes, and the derived classification. | ✓ | ✓ | — | ✓ |
| `ProjectionAuditSuppression` | type | Stable attribution for one suppression: side, stage, reason code, classification, and optional excluded ancestor. | ✓ | ✓ | — | ✓ |
| `ProjectionAuditStage` | type | Projection boundary that caused suppression: `baseline`, `policyScopeRule`, `capability`, `managementScope`, `referenceOnly`, or `managedBy`. | ✓ | ✓ | — | ✓ |
| `ProjectionAuditClassification` | type | `"acknowledged" \| "suspicious"`; entry classification is recomputed from its suppressions at artifact/API boundaries. | — | ✓ | — | ✓ |
| `ProjectionAuditSubject` | type | Stable fact or dependency-edge identity duplicated from the delta for grouping and allowlisting. | ✓ | ✓ | — | ✓ |
| `serializePlan` | function | `Plan → string` — bigint-safe JSON artifact, version-tagged. | — | — | ✓ | — |
| `parsePlan` | function | `string → Plan` — validates formatVersion/engineVersion; throws on mismatch. | — | — | ✓ | — |
| `RenameCandidate` | type | `{ kind, from, to: StableId; status: "unambiguous"\|"ambiguous"\|"nearMiss"; reason? }` — one detected rename candidate with its disposition. | ✓ | ✓ | — | — |
| `RenameMode` | type | `"auto" \| "prompt" \| "off"` — controls whether unambiguous renames are accepted automatically, surfaced for confirmation, or suppressed. | — | — | ✓ | — |
| `LockClass` | type | `"none" \| "share" \| "shareRowExclusive" \| "shareUpdateExclusive" \| "accessExclusive"` — documented lock level of a DDL statement. Reported, not certified. | — | — | ✓ | — |

---

## Apply

| Name | Kind | Contract | facts | deltas | actions | proof |
|------|------|----------|:-----:|:------:|:-------:|:-----:|
| `ActionStatus` | type | `"applied" \| "unapplied" \| "inDoubt"` — per-action outcome after execution. | — | — | ✓ | ✓ |
| `ApplyOptions` | type | `{ fingerprintGate?, lockTimeoutMs?, statementTimeoutMs? }` — executor configuration. | — | — | ✓ | — |
| `ApplyReport` | type | `{ status, appliedActions, actionStatuses, error? }` — execution outcome with per-action status and a structured error entry. | — | — | ✓ | ✓ |
| `apply` | function | `(Plan, Pool, options?) → Promise<ApplyReport>` — sequential, segmented, lock-aware execution. | — | — | ✓ | ✓ |

---

## Proof

| Name | Kind | Contract | facts | deltas | actions | proof |
|------|------|----------|:-----:|:------:|:-------:|:-----:|
| `ProofVerdict` | type | Public compatibility shape for consumer-authored verdicts. Includes proof failures/coverage plus optional `projectionAudit?`, `projectionAuditStatus?`, and `strictAuditFailure?` additive fields. | ✓ | ✓ | ✓ | ✓ |
| `ProducedProofVerdict` | type | Required result shape from `provePlan`: complete normalized `projectionAudit` and explicit `projectionAuditStatus: "available" \| "unavailable"`, plus all state/data/rewrite/coverage fields. | ✓ | ✓ | ✓ | ✓ |
| `ProveOptions` | type | Proof configuration: strict projection-audit enforcement, optional auto-seeding, managed-view policy/capability/baseline inputs, and a profile-aware re-extractor. | ✓ | ✓ | ✓ | ✓ |
| `provePlan` | function | `(Plan, clonePool: Pool, desired: FactBase, options?) → Promise<ProducedProofVerdict>` — applies to a sacrificial clone, proves state/data/rewrite claims, always returns audit status/data, and optionally makes suspicious or unavailable audits blocking through `strictAudit`. | ✓ | ✓ | ✓ | ✓ |

---

## Frontends

| Name | Kind | Contract | facts | deltas | actions | proof |
|------|------|----------|:-----:|:------:|:-------:|:-----:|
| `SqlFile` | type | `{ name: string; sql: string }` — the file abstraction used by both `loadSqlFiles` and `exportSqlFiles`. | ~ | — | — | — |
| `LoadResult` | type | `{ factBase, pgVersion, diagnostics, rounds }` — everything `loadSqlFiles` returns. | ✓ | — | — | — |
| `ShadowLoadError` | class | Structured error from `loadSqlFiles` — carries `details: Diagnostic[]` for stuck files, role leaks, body failures, and DML. | — | — | — | — |
| `loadSqlFiles` | function | `(SqlFile[], shadow: Pool) → Promise<LoadResult>` — parser-free, retry-round ordering, validation, DML rejection. | ✓ | — | — | — |
| `ExportOptions` | type | `{ layout?: "by-object" \| "ordered" }` — controls whether exported files are human-layout or lexicographically ordered. | — | — | — | — |
| `exportSqlFiles` | function | `(FactBase, options?) → SqlFile[]` — render the fact base to SQL files via the planner (plan(∅ → fb)). | ✓ | — | ✓ | — |
| `saveSnapshot` | function | `(FactBase, pgVersion: string, path: string) → void` — serialize and write to disk. | ✓ | — | — | — |
| `loadSnapshot` | function | `(path: string) → { factBase: FactBase; pgVersion: string }` — read, deserialize, verify digest. | ✓ | — | — | — |

---

## Names explicitly NOT exported (and why)

| Name | Location | Reason not exported |
|------|----------|---------------------|
| `segmentActions` | `apply/apply.ts` | Internal executor utility; the action segmentation boundary is plan metadata (`newSegmentBefore`), not a user concern. |
| `matchRenameCandidates` | `plan/renames.ts` | Internal planner helper; the rename results surface via `Plan.renameCandidates`. |
| `subtreeIds` | `plan/renames.ts` | Internal planner utility for rename subtree cancellation. |
| `lockClassFor` | `plan/locks.ts` | Internal rule-table helper; lock information is accessible via `Action.lockClass` on each action. |
| `rulesFor` / `ActionSpec` / `PlanParams` | `plan/rules.ts` | The rule table is an implementation detail of the planner; no caller should need to invoke rules directly. |
| `topoSort` | `plan/graph.ts` | Internal graph utility. |
| `grantTarget` / `qid` | `plan/render.ts` | Internal SQL-rendering utilities. |
| `PayloadValue` | `core/hash.ts` | Implementation detail of `Payload`; not part of the public comparison vocabulary. Callers work with `Payload`. |
| `hashString` | `core/hash.ts` | Internal primitive not needed by API consumers. |
| `FORMAT_VERSION` | `core/snapshot.ts` | Version management is handled inside `serializeSnapshot` / `deserializeSnapshot`; callers need not reference the constant. |

## Policy module (added after the concurrent stage-8 agent landed)

| Name | Kind | Contract | Vocabulary |
|---|---|---|---|
| `Policy` | type | vendor behavior as data: filter + serialize rules + baseline ref + extends | ✓ (policy over deltas, §3.9) |
| `Predicate` | type | serializable matchers over fact kind/identity/provenance/verbs | ✓ |
| `FilterRule` / `SerializeRule` | type | first-match-wins rule shapes | ✓ |
| `factMatches` / `deltaMatches` | function | predicate evaluation against a fact/delta in context | ✓ |
| `filterDeltas` | function | split deltas into kept/filtered — filtered is reported, never silent | ✓ |
| `flattenPolicy` | function | resolve extends with cycle detection | ✓ |
| `validatePolicy` | function | unknown-param + extends-cycle validation | ✓ |
| `serializeParams` | function | **DEPRECATED** — aggregates serialize params globally without per-delta context; misleading second path alongside the planner's own per-fact resolution. Retained in the export surface only because `src/index.ts` re-exports it and that file is outside the current edit boundary. Do not use in new code. | ✗ |
| `subtractBaseline` | function | drop facts present-and-identical in a baseline fact base | ✓ (baselines = fact-base subtraction) |
| `loadBaseline` | function | snapshot file → FactBase with digest verification | ✓ |
| `supabasePolicy` | const | the Supabase vendor package (first DSL consumer) | ✓ |
