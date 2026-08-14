/**
 * @supabase/pg-delta — the public API surface.
 *
 * Every name exported here is part of the package contract; the subpath
 * exports in package.json are the narrower entry points (./extract, ./plan,
 * ./apply, ./proof, …). Design rationale lives in
 * docs/architecture/target-architecture.md.
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
  type ProjectionAudit,
  type ProjectionAuditClassification,
  type ProjectionAuditEntry,
  type ProjectionAuditStage,
  type ProjectionAuditSubject,
  type ProjectionAuditSuppression,
} from "./plan/plan.ts";
export {
  serializePlan,
  parsePlan,
  computePlanId,
  stampPlanId,
} from "./plan/artifact.ts";
export { type RenameCandidate, type RenameMode } from "./plan/renames.ts";
export { type LockClass } from "./plan/locks.ts";

// ── apply ────────────────────────────────────────────────────────────────────
export {
  apply,
  type ApplyError,
  type ApplyReport,
  type ApplyOptions,
  type ApplyEvent,
  type ActionStatus,
} from "./apply/apply.ts";

// ── proof ────────────────────────────────────────────────────────────────────
export {
  provePlan,
  type ProducedProofVerdict,
  type ProveOptions,
  type ProofVerdict,
} from "./proof/prove.ts";

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
  EXPORT_MANIFEST_FILE,
  readExportManifest,
  writeExportManifest,
  type ExportManifest,
} from "./frontends/export-manifest.ts";
export {
  classifySqlContent,
  classifySqlFiles,
  type ClassifySqlFilesInput,
  type SqlFileChange,
  type SqlFileClassification,
} from "./frontends/classify-sql-files.ts";
export {
  buildSchemaExport,
  type BuildSchemaExportOptions,
  type SchemaExportResult,
  type ManagementScope,
} from "./frontends/schema-export.ts";
export { listCustomFiles, type CustomFile } from "./frontends/custom-files.ts";
export {
  planSchemaFiles,
  prepareSchemaFiles,
  reconcileSchemaManifest,
  SchemaFrontendError,
  type PlanSchemaFilesOptions,
  type PlanSchemaFilesResult,
  type PreparedSchemaFiles,
} from "./frontends/schema-plan.ts";
// Schema-first CLI helpers: prune owned stale .sql, dry-run apply SQL, unmodeled-drift probe.
export { pruneStaleSqlFiles } from "./frontends/prune-sql-files.ts";
export { renderApplyScript } from "./frontends/render-apply-script.ts";
export { probeUnmodeledIdentitiesPinned } from "./frontends/schema-plan.ts";
export type { ApplyTimeoutOptions } from "./apply/apply-preamble.ts";
export type { UnmodeledIdentities } from "./extract/unmodeled.ts";
export {
  renderPlanFiles,
  isDestructiveAction,
  type RenderPlanFilesOptions,
  type RenderPlanFilesResult,
  type RenderedPlanFile,
} from "./frontends/render-plan-files.ts";
export {
  provisionCoLocatedShadow,
  ShadowProvisionError,
  isShadowProvisionError,
  withDatabaseName,
  type CoLocatedShadow,
  type ProvisionCoLocatedShadowOptions,
} from "./frontends/shadow.ts";
export {
  parseSslConfig,
  type ParsedSslConfig,
  type SslOptions,
  type SslRole,
} from "./frontends/ssl-config.ts";
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
