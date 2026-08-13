/**
 * Frontends barrel: public frontend modules for schema export / plan / render /
 * shadow provisioning, plus the lower-level SQL load/export helpers.
 */
export {
  loadSqlFiles,
  ShadowLoadError,
  type SqlFile,
  type LoadResult,
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
