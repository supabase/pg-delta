/**
 * Shared helper: create a pg.Pool from a connection URL and provide a
 * dispose function so callers always end the pool.
 */
import createDebug from "debug";
import pg from "pg";

const log = createDebug("pgdelta:pool");

interface ManagedPool {
  pool: pg.Pool;
  end(): Promise<void>;
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

export function makePool(url: string, label?: string): ManagedPool {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const lbl = label ?? safeLabel(url);
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
