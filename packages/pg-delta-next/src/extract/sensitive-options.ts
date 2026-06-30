/**
 * Sensitive-value redaction for foreign-data objects and subscriptions.
 *
 * Foreign-data wrappers (`pg_foreign_data_wrapper.fdwoptions`), servers
 * (`pg_foreign_server.srvoptions`), user mappings (`pg_user_mapping.umoptions`),
 * foreign tables (`pg_foreign_table.ftoptions`), and subscriptions
 * (`pg_subscription.subconninfo`) all store libpq/FDW credentials in cleartext.
 * Any code path that emits these verbatim — plan SQL, catalog snapshots
 * (and thus the fingerprint digest computed over them), declarative export,
 * and the serialized plan artifact — would leak credentials to disk, stdout,
 * CI logs, and version control.
 *
 * Redaction happens HERE, at extract time, so the placeholder propagates
 * uniformly to every downstream channel via the fact base. A useful
 * side-effect: a change to only a secret value redacts identically on both
 * sides of the diff, so it produces no spurious ALTER (env-dependent
 * credentials are not "drift").
 *
 * Option redaction is **allowlist-based**: a value is replaced with
 * `__OPTION_<KEY>__` unless its key is in {@link SAFE_OPTION_KEYS}. The
 * failure mode of a missing entry is "the plan shows a placeholder instead of
 * the real value" — annoying but safe; a denylist's failure mode is a leaked
 * secret, which is the bug this prevents. Match is case-insensitive but exact:
 * a key like `password_validator_extension` redacts unless explicitly listed.
 */

const SAFE_OPTION_KEYS = new Set<string>([
  // libpq connection params (non-credential subset).
  //   https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS
  "host",
  "hostaddr",
  "port",
  "dbname",
  "user",
  "sslmode",
  "sslcompression",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslcrl",
  "sslcrldir",
  "sslsni",
  "requirepeer",
  "krbsrvname",
  "gsslib",
  "sspi",
  "gssencmode",
  "gssdelegation",
  "channel_binding",
  "target_session_attrs",
  // names a pg_service.conf connection-service entry — a reference, not a
  // credential (the real host/user/password live in that file). Must stay
  // visible so a service-name change is a real diff and export/plan-from-empty
  // preserves it instead of emitting `service=__OPTION_SERVICE__`.
  "service",
  "application_name",
  "fallback_application_name",
  "connect_timeout",
  "client_encoding",
  "options",
  "keepalives",
  "keepalives_idle",
  "keepalives_interval",
  "keepalives_count",
  "tcp_user_timeout",
  "replication",
  "load_balance_hosts",
  // postgres_fdw behavior tuning.
  //   https://www.postgresql.org/docs/current/postgres-fdw.html#POSTGRES-FDW-OPTIONS-CONNECTION
  "use_remote_estimate",
  "fdw_startup_cost",
  "fdw_tuple_cost",
  "fetch_size",
  "batch_size",
  "async_capable",
  "analyze_sampling",
  "parallel_commit",
  "parallel_abort",
  // postgres_fdw user-mapping behavior flag (non-credential): documented as a
  // normal option; `password_required=false` lets a non-superuser mapping
  // connect without a password. Must stay visible so the diff and
  // export/plan-from-empty preserve this security-relevant setting.
  "password_required",
  "extensions",
  "updatable",
  "truncatable",
  "schema_name",
  "table_name",
  "column_name",
  // Common shape for table-like FDWs (file_fdw, cloud-storage wrappers).
  "schema",
  "database",
  "table",
  "format",
  "header",
  "delimiter",
  "quote",
  "escape",
  "encoding",
  "compression",
  // Cloud / Supabase Wrappers non-credential shape.
  //   https://github.com/supabase/wrappers
  "region",
  "endpoint",
  "bucket",
  "prefix",
  "location",
  "project_id",
  "dataset_id",
  "dataset",
  "workspace",
  "organization",
  "api_version",
]);

/**
 * Subscription conninfo is fully environment-dependent (host, port, dbname,
 * user, password all differ per environment and the password is a secret), so
 * the entire string is replaced with a fixed placeholder rather than redacted
 * field-by-field. This keeps it out of every output channel AND makes
 * conninfo-only changes invisible to the diff.
 */
export const SUBSCRIPTION_CONNINFO_PLACEHOLDER =
  "host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__";

/**
 * Redact one `key=value` option string (the shape stored in `pg_*options`
 * arrays and consumed by `splitOption` in the plan renderer). Splits on the
 * first `=` so values containing `=` survive intact.
 */
function redactOptionString(opt: string): string {
  const i = opt.indexOf("=");
  if (i === -1) return opt; // valueless option (shouldn't happen) — leave as-is
  const key = opt.slice(0, i);
  if (SAFE_OPTION_KEYS.has(key.toLowerCase())) return opt;
  return `${key}=__OPTION_${key.toUpperCase()}__`;
}

/** Redact every non-allowlisted value in a `key=value` options array. */
export function redactOptionStrings(options: readonly string[]): string[] {
  return options.map(redactOptionString);
}
