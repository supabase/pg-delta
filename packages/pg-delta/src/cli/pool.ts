/**
 * Shared helper: create a pg.Pool from a connection URL and provide a
 * dispose function so callers always end the pool.
 *
 * SSL is derived from the URL's sslmode with libpq semantics via
 * parseSslConfig — sslmode=require/prefer encrypt without chain verification,
 * matching psql and the legacy engine (CLI-2176).
 */
import createDebug from "debug";
import pg from "pg";
import { parseSslConfig, type SslRole } from "../frontends/ssl-config.ts";

const log = createDebug("pgdelta:pool");

export interface ManagedPool {
  pool: pg.Pool;
  end(): Promise<void>;
}

export interface MakePoolOptions {
  /** Credential-free label used in debug logs; defaults to host+database. */
  label?: string;
  /** Env-var prefix selector for PGDELTA_{SOURCE,TARGET}_SSL* fallbacks. */
  role?: SslRole;
}

/** A credential-free label for a connection (host + database only). */
function safeLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "?";
  }
}

export function makePool(
  url: string,
  options: MakePoolOptions = {},
): ManagedPool {
  const { ssl, cleanedUrl } = parseSslConfig(url, options.role ?? "target");
  const pool = new pg.Pool({
    connectionString: cleanedUrl,
    max: 5,
    ...(ssl !== undefined ? { ssl } : {}),
  });
  const lbl = options.label ?? safeLabel(url);
  // Don't crash on an idle client error (server restart, network drop), but
  // surface it under DEBUG=pgdelta:* instead of swallowing it silently —
  // these are exactly the failures worth seeing when troubleshooting (P3). The
  // label carries no credentials.
  pool.on("error", (err: unknown) => {
    log(
      "idle client error [%s]: %s",
      lbl,
      err instanceof Error ? err.message : String(err),
    );
  });
  return {
    pool,
    end: () => pool.end(),
  };
}
