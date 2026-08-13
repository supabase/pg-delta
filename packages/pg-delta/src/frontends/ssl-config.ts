/**
 * libpq-compatible SSL configuration for PostgreSQL connection URLs.
 *
 * node-postgres and libpq disagree about what `sslmode=require` means: libpq
 * (and every psql-style client) treats `require`/`prefer` without a root CA as
 * "encrypt the connection, don't verify the chain", while node-postgres maps
 * it to a TLS socket that verifies against Node's default trust store. Servers
 * whose chains terminate in a private CA (e.g. Supabase-managed databases)
 * are rejected with SELF_SIGNED_CERT_IN_CHAIN / UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * This module bridges the gap the way the legacy engine did (see CLI-2176):
 * it parses the URL's `sslmode`/`sslrootcert`/`sslcert`/`sslkey` parameters
 * into an explicit `ssl` option for `pg.Pool`/`pg.Client` and strips them from
 * the URL — node-postgres merges connection-string parameters over explicit
 * config fields, so a surviving `sslmode` would silently re-enable chain
 * verification.
 *
 * Mode semantics (matching libpq, https://www.postgresql.org/docs/current/libpq-ssl.html):
 * - `disable`                    → no TLS.
 * - `require`/`prefer`, no CA    → encrypt, no chain or hostname verification.
 *   (`prefer` never falls back to plaintext when the server refuses TLS —
 *   node-postgres has no per-connection retry; same limitation as upstream.)
 * - `require`/`prefer` + CA file → behaves like `verify-ca` (libpq compat rule).
 * - `verify-ca` + CA             → verify the chain, skip hostname verification.
 * - `verify-ca`, no CA           → verify chain AND hostname against Node's
 *   default trust store. Deliberate deviation: libpq errors without a root
 *   cert, but skipping hostname checks against the public store would accept
 *   any valid public-CA cert for any host, so we keep full verification.
 * - `verify-full`                → verify chain and hostname.
 * - absent or unrecognized       → passthrough: the URL is returned untouched
 *   and node-postgres' own defaults apply. (The legacy engine forced
 *   `ssl: false` here; passthrough is a deliberate deviation so URLs without
 *   an sslmode keep today's behavior, including pg's PGSSLMODE env handling.)
 *
 * Related art: pg-connection-string (bundled with pg ≥ 8.12) ships a similar
 * translation behind `uselibpqcompat=true`. We keep our own because pg-delta
 * also honors the PGDELTA_*_SSL* env vars as PEM *content* (upstream only
 * reads file paths), reports cert-read failures with the offending path, and
 * deviates on verify-ca-without-CA (upstream throws; we keep verifying).
 *
 * Certificates come from query parameters as file paths (`sslrootcert`,
 * `sslcert`, `sslkey`), or from `PGDELTA_{SOURCE,TARGET}_SSLROOTCERT/SSLCERT/
 * SSLKEY` env vars as PEM content. For `require`/`prefer`, only an explicit
 * `sslrootcert` file activates verification — never the env var — mirroring
 * libpq, which upgrades `require` only when a root CA *file* exists.
 */
import { readFileSync } from "node:fs";

/** Which side of a diff the connection serves; selects the env-var prefix. */
export type SslRole = "source" | "target";

export interface SslOptions {
  rejectUnauthorized: boolean;
  ca?: string;
  cert?: string;
  key?: string;
  /**
   * Custom server identity check. Present when the chain is verified against
   * a caller-supplied CA but the hostname must not be (verify-ca semantics);
   * returning undefined signals success to Node's TLS layer.
   */
  checkServerIdentity?: () => undefined;
}

export interface ParsedSslConfig {
  /**
   * The `ssl` option to pass to `pg.Pool` / `pg.Client`. `false` disables TLS,
   * an object configures it, and absence means "not owned by this parser" —
   * pass the URL through and let node-postgres decide.
   */
  ssl?: false | SslOptions;
  /** The URL with all SSL query parameters stripped (unchanged on passthrough). */
  cleanedUrl: string;
}

const HANDLED_MODES = new Set([
  "disable",
  "require",
  "prefer",
  "verify-ca",
  "verify-full",
]);

/**
 * Read a certificate value: an explicit file path always wins (and a read
 * failure is an error, never a silent fallback); otherwise PEM content from
 * the given env var, if set.
 */
function readCertValue(
  filePath: string | null,
  envVarName: string,
): string | undefined {
  if (filePath) {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (error) {
      throw new Error(
        `Failed to read certificate file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const envValue = process.env[envVarName];
  return envValue || undefined;
}

/**
 * Parse a PostgreSQL connection URL's SSL parameters into node-postgres
 * options with libpq semantics. See the module doc for the exact mode table.
 */
export function parseSslConfig(
  url: string,
  role: SslRole = "target",
): ParsedSslConfig {
  const urlObj = new URL(url);
  const sslmode = urlObj.searchParams.get("sslmode");

  if (sslmode === null || !HANDLED_MODES.has(sslmode)) {
    return { cleanedUrl: url };
  }

  const sslrootcert = urlObj.searchParams.get("sslrootcert");
  const sslcert = urlObj.searchParams.get("sslcert");
  const sslkey = urlObj.searchParams.get("sslkey");
  urlObj.searchParams.delete("sslmode");
  urlObj.searchParams.delete("sslrootcert");
  urlObj.searchParams.delete("sslcert");
  urlObj.searchParams.delete("sslkey");
  const cleanedUrl = urlObj.toString();

  if (sslmode === "disable") {
    return { cleanedUrl, ssl: false };
  }

  const prefix = role === "source" ? "PGDELTA_SOURCE" : "PGDELTA_TARGET";
  const hasExplicitVerification =
    sslmode === "verify-ca" || sslmode === "verify-full";

  // require/prefer only honor an explicit sslrootcert file (libpq's "root CA
  // file exists" upgrade rule); verify-ca/verify-full also fall back to env.
  let caValue: string | undefined;
  if (sslrootcert) {
    caValue = readCertValue(sslrootcert, `${prefix}_SSLROOTCERT`);
  } else if (hasExplicitVerification) {
    caValue = readCertValue(null, `${prefix}_SSLROOTCERT`);
  }

  const shouldVerifyCa = hasExplicitVerification || caValue !== undefined;
  const shouldVerifyHostname = sslmode === "verify-full";

  const ssl: SslOptions = { rejectUnauthorized: shouldVerifyCa };
  if (shouldVerifyCa && caValue) {
    ssl.ca = caValue;
  }
  // Skip hostname verification only against a caller-supplied CA (libpq's
  // verify-ca semantics). Without one, the chain is checked against Node's
  // default public store, where skipping the hostname check would accept any
  // valid public-CA cert for any host — keep full verification instead.
  if (shouldVerifyCa && !shouldVerifyHostname && caValue !== undefined) {
    ssl.checkServerIdentity = () => undefined;
  }

  const certValue = readCertValue(sslcert, `${prefix}_SSLCERT`);
  if (certValue) {
    ssl.cert = certValue;
  }
  const keyValue = readCertValue(sslkey, `${prefix}_SSLKEY`);
  if (keyValue) {
    ssl.key = keyValue;
  }
  if ((ssl.cert && !ssl.key) || (!ssl.cert && ssl.key)) {
    throw new Error(
      "Both client certificate and key must be provided together for mutual TLS",
    );
  }

  return { ssl, cleanedUrl };
}
