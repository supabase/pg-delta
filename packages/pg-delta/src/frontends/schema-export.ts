/**
 * Library frontend: build a declarative schema export (SQL files + manifest
 * metadata) from a live pool. No fs / argv / process I/O — callers write the
 * returned files themselves (see CLI `writeExportFiles`).
 */
import type { Pool } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import {
  type IntegrationProfile,
  resolveProfile,
  type ResolveProfileOptions,
} from "../integrations/profile.ts";
import { flattenPolicy } from "../policy/policy.ts";
import { reconstructManagedView } from "../policy/reconstruct.ts";
import type { ManagementScope } from "../policy/view.ts";
import {
  exportSqlFiles,
  type ExportGrouping,
  type ExportPathStyle,
} from "./export-sql-files.ts";
import type { ExportManifest } from "./export-manifest.ts";
import type { SqlFile } from "./load-sql-files.ts";
import type { SqlFormatOptions } from "./sql-format/index.ts";

export type { ManagementScope };

export interface BuildSchemaExportOptions {
  /** Integration profile to resolve against the pool (default: caller must pass
   *  one — typically `rawProfile` or `supabaseProfile`). */
  profile: IntegrationProfile;
  /** Management scope of the export. Default: `"database"`. */
  scope?: ManagementScope;
  /** Secret redaction mode. Default: `true`. */
  redactSecrets?: boolean;
  /** Extra resolveProfile options (restrictToApplier, baselineDir, …). */
  resolveOptions?: Omit<ResolveProfileOptions, "redactSecrets">;
  layout?: "by-object" | "ordered" | "grouped";
  /** Root-segment style of the emitted paths. Default: `"flat"`
   *  (`<schema>/tables/t.sql` + `_cluster/roles.sql`); `"nested"` reproduces
   *  the historical `schemas/<schema>/…` + `cluster/…` tree. */
  pathStyle?: ExportPathStyle;
  grouping?: ExportGrouping;
  /** Pretty-print options; omit for raw renderer output. */
  format?: SqlFormatOptions;
  /** Default owner whose OWNER TO stays implicit under database scope.
   *  - a role name → that role
   *  - `null` → verbose (every OWNER TO)
   *  - omit → profile defaultOwner, else `datdba` */
  defaultOwner?: string | null;
  /** Soft warnings (e.g. default-owner vs connection-role mismatch). */
  onWarning?: (message: string) => void;
  /** Render `CREATE EXTENSION IF NOT EXISTS`. Off by default. */
  createExtensionIfNotExists?: boolean;
}

export interface SchemaExportResult {
  files: SqlFile[];
  diagnostics: Diagnostic[];
  /** Metadata to stamp into `.pgdelta-export.json` (or pass to planSchemaFiles). */
  manifest: ExportManifest & {
    redactSecrets: boolean;
    scope: ManagementScope;
  };
}

/**
 * Extract, project (policy → scope), and render declarative SQL files for a
 * live database — the same pipeline as `pgdelta schema export`, without writing
 * to disk.
 */
export async function buildSchemaExport(
  pool: Pool,
  options: BuildSchemaExportOptions,
): Promise<SchemaExportResult> {
  const exportScope: ManagementScope = options.scope ?? "database";
  const redactSecrets = options.redactSecrets ?? true;
  const layout = options.layout ?? "by-object";

  const ctx = await resolveProfile(pool, options.profile, {
    ...options.resolveOptions,
    redactSecrets,
  });

  const { factBase, diagnostics } = await ctx.extract(pool, { redactSecrets });

  const assumed = ctx.planOptions.policy
    ? flattenPolicy(ctx.planOptions.policy)
    : undefined;

  let resolvedDefaultOwner: string | null = null;
  if (exportScope === "database") {
    if (options.defaultOwner === null) {
      resolvedDefaultOwner = null;
    } else if (
      options.defaultOwner !== undefined &&
      options.defaultOwner !== ""
    ) {
      resolvedDefaultOwner = options.defaultOwner;
    } else {
      const profileDefault = assumed?.defaultOwner;
      if (profileDefault !== undefined) {
        resolvedDefaultOwner = profileDefault;
      } else {
        const r = await pool.query<{ owner: string }>(
          `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`,
        );
        resolvedDefaultOwner = r.rows[0]?.owner ?? null;
      }
    }
  }

  // reconstruct BEFORE onWarning: resolveProfile keeps the caller-owned policy
  // by reference, so a warning callback that mutates filters must not run until
  // the managed view is already sealed (pre-V1 order: resolveView then warn).
  const scopedView = reconstructManagedView(factBase, {
    policy: ctx.planOptions.policy,
    capability: ctx.planOptions.capability,
    baseline: ctx.planOptions.baseline,
    scope: exportScope,
    ...(resolvedDefaultOwner !== null
      ? { defaultOwner: resolvedDefaultOwner }
      : {}),
  });
  if (exportScope === "database" && resolvedDefaultOwner !== null) {
    const cu = (await pool.query<{ u: string }>(`SELECT current_user AS u`))
      .rows[0]?.u;
    if (cu !== undefined && cu !== resolvedDefaultOwner) {
      options.onWarning?.(
        `the resolved default owner "${resolvedDefaultOwner}" differs from the export ` +
          `connection role "${cu}"; ownership of its objects will be left implicit (no OWNER TO). ` +
          `Apply this directory connecting as "${resolvedDefaultOwner}", or re-export with ` +
          `defaultOwner "${cu}" / defaultOwner null (verbose).`,
      );
    }
  }
  const scopeAssumedRoles =
    exportScope === "database"
      ? factBase
          .facts()
          .filter((f) => f.id.kind === "role")
          .map((f) => (f.id as { name: string }).name)
      : [];
  const assumedSchemas = assumed?.assumedSchemas ?? [];
  const assumedRoles = [...(assumed?.assumedRoles ?? []), ...scopeAssumedRoles];

  const files = exportSqlFiles(scopedView, {
    layout,
    ...(options.pathStyle !== undefined
      ? { pathStyle: options.pathStyle }
      : {}),
    ...(options.grouping !== undefined ? { grouping: options.grouping } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
    ...(assumedSchemas.length > 0 ? { assumedSchemas } : {}),
    ...(assumedRoles.length > 0 ? { assumedRoles } : {}),
    ...(ctx.planOptions.intentRules !== undefined
      ? { intentRules: ctx.planOptions.intentRules }
      : {}),
    ...(options.onWarning !== undefined
      ? { onWarning: options.onWarning }
      : {}),
    ...(options.createExtensionIfNotExists === true
      ? { createExtensionIfNotExists: true }
      : {}),
  });

  const exportProfileId = ctx.planOptions.profile?.id;
  const manifest: SchemaExportResult["manifest"] = {
    redactSecrets,
    scope: exportScope,
    ...(exportProfileId !== undefined ? { profile: exportProfileId } : {}),
    ...(ctx.baseline !== undefined
      ? { baselineDigest: ctx.baseline.digest }
      : {}),
    ...(exportScope === "database"
      ? { defaultOwner: resolvedDefaultOwner }
      : {}),
  };

  return { files, diagnostics, manifest };
}
