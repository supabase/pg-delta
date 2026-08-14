/**
 * Frontends barrel: public frontend modules for schema export / plan / render /
 * shadow provisioning, plus the lower-level SQL load/export helpers.
 */
export {
  loadSqlFiles,
  ShadowLoadError,
  type SqlFile,
  type LoadResult,
  type LoadSqlFilesOptions,
} from "./load-sql-files.ts";

export { exportSqlFiles, type ExportOptions } from "./export-sql-files.ts";

export { saveSnapshot, loadSnapshot } from "./snapshot-file.ts";

export {
  parseSslConfig,
  type ParsedSslConfig,
  type SslOptions,
  type SslRole,
} from "./ssl-config.ts";

export {
  EXPORT_MANIFEST_FILE,
  readExportManifest,
  writeExportManifest,
  type ExportManifest,
} from "./export-manifest.ts";

export {
  classifySqlContent,
  classifySqlFiles,
  type ClassifySqlFilesInput,
  type SqlFileChange,
  type SqlFileClassification,
} from "./classify-sql-files.ts";

export {
  buildSchemaExport,
  type BuildSchemaExportOptions,
  type SchemaExportResult,
  type ManagementScope,
} from "./schema-export.ts";

export { listCustomFiles, type CustomFile } from "./custom-files.ts";

export {
  planSchemaFiles,
  prepareSchemaFiles,
  reconcileSchemaManifest,
  SchemaFrontendError,
  type PlanSchemaFilesOptions,
  type PlanSchemaFilesResult,
  type PreparedSchemaFiles,
  type PrepareSchemaFilesOptions,
  type ReconcileSchemaManifestFlags,
  type ReconciledSchemaOptions,
} from "./schema-plan.ts";

// Schema-first CLI helpers: prune owned stale .sql, dry-run apply SQL, unmodeled-drift probe.
export { pruneStaleSqlFiles } from "./prune-sql-files.ts";
export { renderApplyScript } from "./render-apply-script.ts";
export { probeUnmodeledIdentitiesPinned } from "./schema-plan.ts";
export type { ApplyTimeoutOptions } from "../apply/apply-preamble.ts";
export type { UnmodeledIdentities } from "../extract/unmodeled.ts";

// Schema-first CLI helpers: coverage gate, data-loss listing, database identity.
export {
  STRICT_COVERAGE_CODES,
  hasBlockingDiagnostics,
} from "./diagnostics.ts";
export { dataLossActions, type DataLossAction } from "./data-loss-actions.ts";
export { type SourceDatabaseIdentity } from "../plan/plan.ts";
export {
  observeDatabaseIdentity,
  databaseIdentityStamp,
  isDatabaseIdentityObservationUnavailable,
  databaseIdentityObservationUnavailableCode,
  observeDatabaseIdentityForMutation,
  isSamePostgresLineage,
  isSameDatabase,
  type ObservedDatabaseIdentity,
  type DatabaseIdentityObservationUnavailableCode,
} from "../database-identity.ts";

export {
  renderPlanFiles,
  isDestructiveAction,
  type RenderPlanFilesOptions,
  type RenderPlanFilesResult,
  type RenderedPlanFile,
} from "./render-plan-files.ts";

export {
  provisionCoLocatedShadow,
  ShadowProvisionError,
  isShadowProvisionError,
  withDatabaseName,
  type CoLocatedShadow,
  type ProvisionCoLocatedShadowOptions,
} from "./shadow.ts";
