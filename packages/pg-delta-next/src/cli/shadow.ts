/**
 * Co-located shadow provisioning (quick mode).
 *
 * When `schema apply` is run WITHOUT an explicit `--shadow`, the shadow database
 * is created on the TARGET's own cluster: a fresh, throwaway database named
 * `pgdelta_shadow_<ts>_<rand>`, used to elaborate the declarative files, then
 * dropped. Co-locating with the target means the shadow shares the target's
 * cluster-global roles (so platform-owned schemas like `auth`/`storage` seed
 * cleanly) and its extension availability, with a single connection string.
 *
 * Safety: only `database` scope is permitted (creating cluster-global role DDL on
 * the target's cluster is never done — the cluster-DDL guard + database-scope
 * projection ensure the load and diff touch only the throwaway database). The
 * shadow is a SEPARATE database, so the target database itself is never written.
 * Only databases we created (tracked by name) are dropped.
 */
import { makePool } from "./pool.ts";

/** Swap the database name in a connection URL, preserving everything else. */
export function withDatabaseName(url: string, dbname: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(dbname)}`;
  return u.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Only ever created/dropped by us. */
const SHADOW_PREFIX = "pgdelta_shadow_";

export interface CoLocatedShadow {
  /** connection URL to the freshly-created shadow database */
  url: string;
  /** database name (for logging) */
  name: string;
  /** drop the shadow database (no-op when `keep`), best-effort. */
  cleanup(): Promise<void>;
}

export interface ProvisionOptions {
  /** keep the shadow database after the run (debugging) instead of dropping it */
  keep?: boolean;
  /** unique suffix source; injectable for deterministic tests */
  uniqueSuffix?: string;
}

/**
 * Create a throwaway shadow database on the TARGET's cluster and return its URL
 * plus a cleanup that drops it. The maintenance statements run on the target's
 * own connection (a sibling database is created/dropped, never the target DB).
 * Throws a friendly error if the connecting role lacks CREATEDB.
 */
export async function provisionCoLocatedShadow(
  targetUrl: string,
  opts: ProvisionOptions = {},
): Promise<CoLocatedShadow> {
  const suffix =
    opts.uniqueSuffix ??
    `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  const name = `${SHADOW_PREFIX}${suffix}`;

  const maint = makePool(targetUrl, "shadow-provision");
  try {
    const probe = await maint.pool.query<{ can: boolean }>(
      `SELECT (rolcreatedb OR rolsuper) AS can FROM pg_roles WHERE rolname = current_user`,
    );
    if (probe.rows[0]?.can !== true) {
      throw new ShadowProvisionError(
        "the connecting role lacks CREATEDB on the target cluster, so a co-located shadow cannot be created; pass an explicit --shadow <pg-url> to a dedicated empty database instead.",
      );
    }
    // CREATE DATABASE cannot run in a transaction; pg.Pool queries autocommit.
    // template0 gives a pristine database independent of template1 customization.
    await maint.pool.query(
      `CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0`,
    );
  } finally {
    await maint.end();
  }

  return {
    url: withDatabaseName(targetUrl, name),
    name,
    cleanup: async () => {
      if (opts.keep === true) return;
      const m = makePool(targetUrl, "shadow-cleanup");
      try {
        // WITH (FORCE) terminates any lingering connections (PG13+). Best-effort:
        // a failed drop leaves a clearly-named throwaway db, never affects the run.
        await m.pool.query(
          `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`,
        );
      } catch {
        // swallow — cleanup must never mask the apply's own outcome
      } finally {
        await m.end();
      }
    },
  };
}

export class ShadowProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShadowProvisionError";
  }
}

/** Type guard so the CLI can render provisioning errors without a stack. */
export function isShadowProvisionError(e: unknown): e is ShadowProvisionError {
  return e instanceof ShadowProvisionError;
}
