/**
 * Co-located shadow provisioning (quick mode).
 *
 * When declarative apply runs WITHOUT an explicit shadow URL, the shadow
 * database is created on the TARGET's own cluster: a fresh, throwaway database
 * named `pgdelta_shadow_<ts>_<rand>`, used to elaborate the declarative files,
 * then dropped. Co-locating with the target means the shadow shares the
 * target's cluster-global roles and extension availability.
 *
 * Safety: only `database` scope is permitted for co-located shadows. The
 * shadow is a SEPARATE database, so the target database itself is never
 * written. Only databases we created (tracked by name) are dropped.
 *
 * Callers own every Pool they open against the returned URL and must
 * `pool.end()` before calling `cleanup()`.
 */
import pg from "pg";
import { parseSslConfig } from "./ssl-config.ts";

/** Swap the database name in a connection URL, preserving everything else. */
export function withDatabaseName(url: string, dbname: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(dbname)}`;
  return u.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function makePool(url: string): pg.Pool {
  // libpq sslmode semantics (require/prefer = encrypt without verification) so
  // co-located shadows work against targets with private-CA chains (CLI-2176).
  const { ssl, cleanedUrl } = parseSslConfig(url);
  const pool = new pg.Pool({
    connectionString: cleanedUrl,
    max: 5,
    ...(ssl !== undefined ? { ssl } : {}),
  });
  pool.on("error", () => {
    // idle client errors (server restart) must not crash the process
  });
  return pool;
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

export interface ProvisionCoLocatedShadowOptions {
  /** keep the shadow database after the run (debugging) instead of dropping it */
  keep?: boolean;
  /** unique suffix source; injectable for deterministic tests */
  uniqueSuffix?: string;
}

/**
 * Create a throwaway shadow database on the TARGET's cluster and return its URL
 * plus a cleanup that drops it. Throws {@link ShadowProvisionError} if the
 * connecting role lacks CREATEDB.
 */
export async function provisionCoLocatedShadow(
  targetUrl: string,
  opts: ProvisionCoLocatedShadowOptions = {},
): Promise<CoLocatedShadow> {
  const suffix =
    opts.uniqueSuffix ??
    `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  const name = `${SHADOW_PREFIX}${suffix}`;

  const maint = makePool(targetUrl);
  try {
    const probe = await maint.query<{ can: boolean }>(
      `SELECT (rolcreatedb OR rolsuper) AS can FROM pg_roles WHERE rolname = current_user`,
    );
    if (probe.rows[0]?.can !== true) {
      throw new ShadowProvisionError(
        "the connecting role lacks CREATEDB on the target cluster, so a co-located shadow cannot be created; pass an explicit shadow URL to a dedicated empty database instead.",
      );
    }
    await maint.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0`);
  } finally {
    await maint.end();
  }

  return {
    url: withDatabaseName(targetUrl, name),
    name,
    cleanup: async () => {
      if (opts.keep === true) return;
      const m = makePool(targetUrl);
      try {
        await m.query(
          `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`,
        );
      } catch {
        // swallow — cleanup must never mask the caller's own outcome
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

/** Type guard so callers can render provisioning errors without a stack. */
export function isShadowProvisionError(e: unknown): e is ShadowProvisionError {
  return e instanceof ShadowProvisionError;
}
