/**
 * @supabase/pg-delta — clean-room rebuild per docs/architecture/target-architecture.md.
 * Public API per §4.5; the complete vocabulary is listed here and reviewed
 * in API-REVIEW.md (stage-9 deliverable 8).
 */

// ── core primitives ──────────────────────────────────────────────────────────
export { NotImplementedError, type Diagnostic } from "./core/diagnostic.ts";
export {
  encodeId,
  parseId,
  type StableId,
  type FactKind,
} from "./core/stable-id.ts";
export {
  canonicalize,
  contentHash,
  type Payload,
  type ContentHash,
} from "./core/hash.ts";
export {
  buildFactBase,
  FactBase,
  type Fact,
  type DependencyEdge,
  type EdgeKind,
} from "./core/fact.ts";
export { serializeSnapshot, deserializeSnapshot } from "./core/snapshot.ts";
export { diff, type Delta } from "./core/diff.ts";

// ── extract ──────────────────────────────────────────────────────────────────
export {
  extract,
  ExtractionTimeoutError,
  type ExtractResult,
} from "./extract/extract.ts";

// ── plan ─────────────────────────────────────────────────────────────────────
export {
  plan,
  ENGINE_VERSION,
  type Plan,
  type Action,
  type PlanOptions,
  type SafetyReport,
} from "./plan/plan.ts";
export { serializePlan, parsePlan } from "./plan/artifact.ts";
export { type RenameCandidate, type RenameMode } from "./plan/renames.ts";
export { type LockClass } from "./plan/locks.ts";

// ── apply ────────────────────────────────────────────────────────────────────
export {
  apply,
  type ApplyReport,
  type ApplyOptions,
  type ActionStatus,
} from "./apply/apply.ts";

// ── proof ────────────────────────────────────────────────────────────────────
export { provePlan, type ProofVerdict } from "./proof/prove.ts";

// ── frontends ────────────────────────────────────────────────────────────────
export {
  loadSqlFiles,
  ShadowLoadError,
  type SqlFile,
  type LoadResult,
} from "./frontends/load-sql-files.ts";
export {
  exportSqlFiles,
  type ExportOptions,
} from "./frontends/export-sql-files.ts";
export { saveSnapshot, loadSnapshot } from "./frontends/snapshot-file.ts";
export {
  factMatches,
  deltaMatches,
  filterDeltas,
  flattenPolicy,
  validatePolicy,
  type Policy,
  type Predicate,
  type FilterRule,
  type SerializeRule,
} from "./policy/policy.ts";
export {
  subtractBaseline,
  loadBaselineFile,
  type LoadedBaseline,
  resolveBaseline,
} from "./policy/baseline.ts";
export { supabasePolicy } from "./policy/supabase.ts";

// ── integrations (the safe, profile-scoped path) ─────────────────────────────
// The headline managed-view API: resolve a profile against a source pool, then
// route extract / plan / prove / apply through the resolved option bundles so
// they reconstruct the same view (plan == prove == apply). The full surface
// (handlers, capability probing, custom-profile building blocks) lives on the
// `@supabase/pg-delta/integrations` subpath.
export {
  resolveProfile,
  rawProfile,
  supabaseProfile,
  type IntegrationProfile,
  type ResolvedProfile,
  type ResolveProfileOptions,
} from "./integrations/index.ts";
