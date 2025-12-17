/**
 * Plan creation - the main entry point for creating migration plans.
 */

import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { diffCatalogs } from "../catalog.diff.ts";
import type { Catalog } from "../catalog.model.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { compileFilterDSL } from "../integrations/filter/dsl.ts";
import { postgresConfig } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import { classifyChangesRisk } from "./risk.ts";
import type { CreatePlanOptions, Plan } from "./types.ts";

// ============================================================================
// Plan Creation
// ============================================================================

/**
 * Create a migration plan by comparing two databases.
 *
 * @param fromUrl - Source database connection URL (current state)
 * @param toUrl - Target database connection URL (desired state)
 * @param options - Optional configuration
 * @returns A Plan if there are changes, null if databases are identical
 */
import type { Sql } from "postgres";

type ConnectionInput = string | Sql;

type SslConfig = {
  ssl?:
    | boolean
    | {
        rejectUnauthorized: boolean;
        ca?: string;
        cert?: string;
        key?: string;
      };
  cleanedUrl: string;
};

/**
 * Parse SSL configuration from a PostgreSQL connection URL.
 * Supports sslmode (require, verify-ca, verify-full, prefer, disable).
 * Certificates can be provided via:
 * - Query string parameters (file paths): sslrootcert, sslcert, sslkey (preferred)
 * - Environment variables (content): PGDELTA_SOURCE_SSLROOTCERT/SSLCERT/SSLKEY or PGDELTA_TARGET_SSLROOTCERT/SSLCERT/SSLKEY
 * Returns SSL options for the postgres.js library and a cleaned URL without SSL-related query parameters.
 */
async function parseSslConfig(
  url: string,
  connectionType: "source" | "target",
): Promise<SslConfig> {
  const urlObj = new URL(url);
  const sslmode = urlObj.searchParams.get("sslmode");
  const sslrootcert = urlObj.searchParams.get("sslrootcert");
  const sslcert = urlObj.searchParams.get("sslcert");
  const sslkey = urlObj.searchParams.get("sslkey");

  // Remove SSL-related query parameters since we parse them ourselves
  urlObj.searchParams.delete("sslmode");
  urlObj.searchParams.delete("sslrootcert");
  urlObj.searchParams.delete("sslcert");
  urlObj.searchParams.delete("sslkey");
  const cleanedUrl = urlObj.toString();

  // Handle different SSL modes
  if (sslmode === "disable") {
    return { cleanedUrl };
  }

  if (
    sslmode === "require" ||
    sslmode === "prefer" ||
    sslmode === "verify-ca" ||
    sslmode === "verify-full"
  ) {
    const rejectUnauthorized =
      sslmode === "verify-ca" || sslmode === "verify-full";

    const ssl: {
      rejectUnauthorized: boolean;
      ca?: string;
      cert?: string;
      key?: string;
    } = {
      rejectUnauthorized,
    };

    // Helper function to get certificate value: query param (file path) takes precedence over env var (content)
    const getCertValue = async (
      queryParam: string | null,
      envVarName: string,
    ): Promise<string | undefined> => {
      // Prefer query parameter (file path)
      if (queryParam) {
        try {
          return await readFile(queryParam, "utf-8");
        } catch (error) {
          throw new Error(
            `Failed to read certificate file '${queryParam}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // Fallback to environment variable (content)
      const envValue = process.env[envVarName];
      return envValue || undefined;
    };

    // Get CA certificate (required for verify-ca/verify-full)
    if (rejectUnauthorized) {
      const caEnvVar =
        connectionType === "source"
          ? "PGDELTA_SOURCE_SSLROOTCERT"
          : "PGDELTA_TARGET_SSLROOTCERT";
      const caValue = await getCertValue(sslrootcert, caEnvVar);
      if (caValue) {
        ssl.ca = caValue;
      }
    }

    // Get client certificate (optional, for mutual TLS)
    const certEnvVar =
      connectionType === "source"
        ? "PGDELTA_SOURCE_SSLCERT"
        : "PGDELTA_TARGET_SSLCERT";
    const certValue = await getCertValue(sslcert, certEnvVar);
    if (certValue) {
      ssl.cert = certValue;
    }

    // Get client key (optional, for mutual TLS, required if cert is provided)
    const keyEnvVar =
      connectionType === "source"
        ? "PGDELTA_SOURCE_SSLKEY"
        : "PGDELTA_TARGET_SSLKEY";
    const keyValue = await getCertValue(sslkey, keyEnvVar);
    if (keyValue) {
      ssl.key = keyValue;
    }

    // Warn if cert is provided without key (or vice versa)
    if ((ssl.cert && !ssl.key) || (!ssl.cert && ssl.key)) {
      throw new Error(
        "Both client certificate and key must be provided together for mutual TLS",
      );
    }

    return { ssl, cleanedUrl };
  }

  // No sslmode specified or invalid value - no SSL configuration
  return { cleanedUrl };
}

export async function createPlan(
  source: ConnectionInput,
  target: ConnectionInput,
  options: CreatePlanOptions = {},
): Promise<{ plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null> {
  const sourceSslConfig =
    typeof source === "string" ? await parseSslConfig(source, "source") : null;
  const targetSslConfig =
    typeof target === "string" ? await parseSslConfig(target, "target") : null;

  const sourceSql =
    typeof source === "string" && sourceSslConfig
      ? postgres(sourceSslConfig.cleanedUrl, {
          ...postgresConfig,
          ...(sourceSslConfig.ssl ? { ssl: sourceSslConfig.ssl } : {}),
        })
      : (source as Sql);
  const targetSql =
    typeof target === "string" && targetSslConfig
      ? postgres(targetSslConfig.cleanedUrl, {
          ...postgresConfig,
          ...(targetSslConfig.ssl ? { ssl: targetSslConfig.ssl } : {}),
        })
      : (target as Sql);
  const shouldCloseFrom = typeof source === "string";
  const shouldCloseTo = typeof target === "string";

  try {
    const [fromCatalog, toCatalog] = await Promise.all([
      extractCatalog(sourceSql),
      extractCatalog(targetSql),
    ]);

    return buildPlanForCatalogs(fromCatalog, toCatalog, options);
  } finally {
    const closers: Promise<unknown>[] = [];
    if (shouldCloseFrom) closers.push(sourceSql.end());
    if (shouldCloseTo) closers.push(targetSql.end());
    if (closers.length) {
      await Promise.all(closers);
    }
  }
}

/**
 * Build a plan (and supporting artifacts) from already extracted catalogs.
 */
function buildPlanForCatalogs(
  fromCatalog: Catalog,
  toCatalog: Catalog,
  options: CreatePlanOptions = {},
): { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null {
  const changes = diffCatalogs(fromCatalog, toCatalog, {
    role: options.role,
  });

  const integration = options.integration;
  const filterDSL = options.filter;
  const ctx: DiffContext = {
    mainCatalog: fromCatalog,
    branchCatalog: toCatalog,
  };

  // Compile filter DSL if provided, otherwise use integration filter
  let filterFn = integration?.filter;
  if (filterDSL) {
    filterFn = compileFilterDSL(filterDSL);
  }

  const filteredChanges = filterFn
    ? changes.filter((change) => filterFn!(change))
    : changes;

  if (filteredChanges.length === 0) {
    return null;
  }

  const sortedChanges = sortChanges(ctx, filteredChanges);
  const plan = buildPlan(ctx, sortedChanges, options, filterDSL);

  return { plan, sortedChanges, ctx };
}

// ============================================================================
// Plan Building
// ============================================================================

/**
 * Build a Plan from sorted changes.
 */
function buildPlan(
  ctx: DiffContext,
  changes: Change[],
  options?: CreatePlanOptions,
  filterDSL?: CreatePlanOptions["filter"],
): Plan {
  const role = options?.role;
  const statements = generateStatements(changes, {
    integration: options?.integration,
    role,
  });
  const risk = classifyChangesRisk(changes);

  const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    changes,
  );
  const fingerprintTo = hashStableIds(ctx.branchCatalog, stableIds);

  return {
    version: 1,
    source: { fingerprint: fingerprintFrom },
    target: { fingerprint: fingerprintTo },
    statements,
    role,
    filter: filterDSL,
    risk,
  };
}

/**
 * Generate the individual SQL statements that make up the plan.
 */
function generateStatements(
  changes: Change[],
  options?: {
    integration?: CreatePlanOptions["integration"];
    role?: string;
  },
): string[] {
  const statements: string[] = [];

  if (options?.role) {
    statements.push(`SET ROLE "${options.role}"`);
  }

  if (hasRoutineChanges(changes)) {
    statements.push("SET check_function_bodies = false");
  }

  for (const change of changes) {
    const sql = options?.integration?.serialize?.(change) ?? change.serialize();
    statements.push(sql);
  }

  return statements;
}

/**
 * Check if any changes involve routines (procedures or aggregates).
 * Used to determine if we need to disable function body checking.
 */
function hasRoutineChanges(changes: Change[]): boolean {
  return changes.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
}
