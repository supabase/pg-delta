/**
 * Stage 7: the shadow-DB frontend — SQL files → fact base
 * (target-architecture §3.2). Parser-free by design:
 * - ordering: bounded retry rounds at FILE granularity against the shadow
 *   (fail-safe — errors surface before anything is extracted)
 * - body validation: routines re-validated with checks ON after loading
 * - shared-object isolation: pg_roles + pg_auth_members snapshot before/after;
 *   leakage fails in "databaseScratch" mode (skipped in "isolatedCluster" mode)
 * - DML detection: any user table containing rows is reported, by observation
 *
 * ## Loader modes
 *
 * ### "databaseScratch" (default)
 * The shadow database lives on a shared PostgreSQL cluster. Cluster-level
 * objects (roles, role memberships) are visible to every other database on
 * the same cluster, so any file that creates roles or modifies memberships
 * would pollute the shared catalog — this is called a "leak". The loader
 * snapshots pg_roles and pg_auth_members before loading and after; if the
 * sets differ, it throws a ShadowLoadError. Use this mode for typical CI /
 * tooling usage where one cluster hosts many test databases. The shadow must
 * also be EMPTY before the load, and no managed table may hold pre-existing
 * rows (`allowPreExistingRows` defaults to false here).
 *
 * ### "isolatedCluster"
 * The shadow database has its own dedicated PostgreSQL cluster (e.g. from
 * isolatedClusterPair()). Because no other database shares that cluster,
 * role/membership side-effects are confined and harmless. The shared-object
 * snapshot check is SKIPPED entirely; files that CREATE ROLE or GRANT role
 * memberships will load successfully. Use this mode when your SQL files
 * intentionally manage cluster-level state.
 *
 * A dedicated shadow is also allowed to be PRE-PROVISIONED: the Supabase CLI
 * boots its platform services (auth, storage, realtime, …) against the shadow
 * before any declarative SQL is loaded, so their migration bookkeeping tables
 * already hold rows. `allowPreExistingRows` therefore defaults to TRUE in this
 * mode: the loader snapshots WHICH managed tables are populated BEFORE the load
 * and exempts exactly those from the post-load DML observation, silently (no
 * diagnostic). Documented limitation: the snapshot keys on the qualified table
 * NAME, never on row contents — the loader deliberately never compares data — so
 * a table that was already populated stays exempt even if a declarative file
 * inserts into it, and a drop+recreate of the same name remains exempt too.
 *
 * ## DML observation severity
 * A managed non-extension table that holds rows the load cannot account for is a
 * `data_statement` WARNING on {@link LoadResult.diagnostics} by default and the
 * load PROCEEDS: Postgres accepted the rows, and pg-delta only ever diffs
 * schema, so refusing to read the schema back would block every directory that
 * carries incidental data. Set `strictDataStatements: true` (CLI
 * `--strict-data-statements`) to restore the fatal `ShadowLoadError` for CI.
 * Extension-owned relations (pg_depend deptype 'e') are always out of scope.
 */
import type { Pool, PoolClient, QueryResult } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import { qid } from "../plan/render.ts";
import { buildFactBase, type FactBase } from "../core/fact.ts";
import {
  extract,
  type ExtractOptions,
  type ExtractResult,
} from "../extract/extract.ts";
import { notExtensionMember, USER_SCHEMA_FILTER } from "../extract/scope.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { splitSqlStatements } from "./sql-format/format-utils.ts";

/** SQLSTATE 25001 ("active_sql_transaction") — raised when a statement that
 *  cannot run inside a transaction block (CREATE INDEX CONCURRENTLY, VACUUM, …)
 *  is attempted within one. Detection by effect, not by parsing (P1). */
function isNonTransactional(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return (
    code === "25001" ||
    (error instanceof Error &&
      /cannot run inside a transaction block/i.test(error.message))
  );
}

/**
 * The only statement the raw 25001 fallback (below) is allowed to run. The raw
 * retry executes OUTSIDE the per-file transaction that otherwise confines the
 * load to the throwaway shadow database, so on a co-located shadow an unlisted
 * statement would escape the sandbox and hit the target's live cluster. CREATE
 * INDEX CONCURRENTLY is the one non-transactional statement a declarative schema
 * legitimately contains; every other 25001-raiser (VACUUM, REINDEX, CREATE
 * DATABASE / TABLESPACE, ALTER SYSTEM, CREATE SUBSCRIPTION opening a live
 * replication connection, …) is refused. Match by effect (Postgres already
 * signalled 25001) then by masked skeleton, never by parsing.
 */
const RAW_FALLBACK_ALLOWLIST: RegExp[] = [
  /^\s*create\s+(unique\s+)?index\s+concurrently\b/i,
];

/**
 * Apply one file's SQL inside an EXPLICIT transaction (hardening Item 6 /
 * review #5), so a mid-file failure leaves NO partial state and the file can be
 * cleanly retried in a later round — instead of relying on PostgreSQL's
 * implicit multi-statement-query transaction. This guarantee holds because
 * `loadSqlFiles` first rejects any file that manages its own transaction
 * (findTransactionControl), so the file cannot COMMIT partway through. A
 * statement that cannot run in a transaction block (e.g. CREATE INDEX
 * CONCURRENTLY) is re-run RAW on the throwaway shadow, detected by effect
 * (SQLSTATE 25001); its real error, if any, still surfaces to the caller.
 */
async function applyFile(client: PoolClient, sql: string): Promise<void> {
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (isNonTransactional(error)) {
      // a statement that cannot run in a transaction block (CREATE INDEX
      // CONCURRENTLY, …) must be the file's ONLY statement: a raw whole-file
      // retry of a multi-statement file applies the rest non-atomically and can
      // leave the shadow partially loaded on a later failure (review P2). Reuse
      // the literal/comment/dollar-quote mask so `;` inside bodies isn't counted.
      const masked = maskLiteralsAndComments(sql);
      const statementCount = masked
        .split(";")
        .filter((s) => s.trim() !== "").length;
      if (statementCount > 1) {
        throw new ShadowLoadError(
          `a non-transactional statement (e.g. CREATE INDEX CONCURRENTLY) must be the only statement in its file, but this file has ${statementCount} statements — move the non-transactional statement into its own file`,
          [
            {
              code: "mixed_nontransactional_file",
              severity: "error",
              message: `file mixes a non-transactional statement with ${statementCount - 1} other statement(s)`,
            },
          ],
        );
      }
      // The raw retry runs OUTSIDE the per-file transaction, bypassing the
      // sandbox that confines the load to the throwaway shadow. Only CREATE
      // INDEX CONCURRENTLY may take that path; anything else (VACUUM, CREATE
      // DATABASE / TABLESPACE, ALTER SYSTEM, …) could mutate the target's live
      // cluster, so refuse it instead of executing it unsandboxed.
      if (!RAW_FALLBACK_ALLOWLIST.some((re) => re.test(masked.trim()))) {
        throw new ShadowLoadError(
          "a non-transactional statement other than CREATE INDEX CONCURRENTLY cannot be loaded: the raw retry runs outside the shadow's transactional sandbox and could touch the target's live cluster",
          [
            {
              code: "unsupported_non_transactional",
              severity: "error",
              message: `refused non-transactional statement: ${sql.trim().slice(0, 80)}`,
            },
          ],
        );
      }
      await client.query(sql);
      return;
    }
    throw error;
  }
}

/**
 * Enrich a failed file's error with the offending statement's location. A file
 * is applied as ONE multi-statement query, so node-postgres sets `position` (a
 * 1-based character offset into the file's SQL) on the DatabaseError. Turn that
 * into an "at line N: <excerpt>" suffix so a stuck / non-converged load reports
 * WHICH statement failed inside a multi-statement file, not just the file name +
 * bare message. The position comes straight from PostgreSQL — no SQL parsing.
 */
function describeFileFailure(sql: string, error: unknown): string {
  const base = error instanceof Error ? error.message : String(error);
  const raw = (error as { position?: unknown } | null)?.position;
  const pos =
    typeof raw === "string"
      ? Number.parseInt(raw, 10)
      : typeof raw === "number"
        ? raw
        : Number.NaN;
  if (!Number.isFinite(pos) || pos < 1 || pos > sql.length) return base;
  const before = sql.slice(0, pos - 1);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const nl = sql.indexOf("\n", pos - 1);
  const lineText = sql.slice(lineStart, nl === -1 ? undefined : nl).trim();
  const excerpt = lineText.length > 80 ? `${lineText.slice(0, 80)}…` : lineText;
  return `${base} — at line ${line}: ${excerpt}`;
}

/**
 * Blank out comments and string/identifier/dollar-quoted literals, replacing
 * their contents (and any `;` inside them) with spaces so the remaining "code
 * skeleton" can be scanned for statement-level keywords without a SQL grammar.
 * This is literal masking, not dependency parsing — it does not violate the
 * parser-free / "Postgres is the elaborator" principle.
 */
function maskLiteralsAndComments(
  sql: string,
  opts: { quotedIdentifiers?: "blank" | "keep" } = {},
): string {
  const keepQuotedIdentifiers = opts.quotedIdentifiers === "keep";
  const out: string[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    const next = sql[i + 1];
    // line comment
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // block comment (nested, as in PostgreSQL)
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out.push(" ");
      continue;
    }
    // single-quoted string ('' is an escaped quote)
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      out.push(" ");
      continue;
    }
    // double-quoted identifier ("" is an escaped quote)
    if (c === '"') {
      i++;
      out.push(" ");
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          if (keepQuotedIdentifiers) out.push('"');
          i += 2;
        } else if (sql[i] === '"') {
          i++;
          out.push(" ");
          break;
        } else {
          if (keepQuotedIdentifiers) out.push(sql[i] as string);
          i++;
        }
      }
      continue;
    }
    // dollar-quoted string: $tag$ ... $tag$ (tag may be empty)
    if (c === "$") {
      const tagMatch = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        out.push(" ");
        continue;
      }
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Statement-leading transaction-control forms. `BEGIN ATOMIC` (a PG14+ SQL
 *  function body) is explicitly NOT transaction control. */
const TXN_CONTROL_RULES: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /^start\s+transaction\b/i, label: "START TRANSACTION" },
  { re: /^prepare\s+transaction\b/i, label: "PREPARE TRANSACTION" },
  { re: /^begin(?!\s+atomic\b)\b/i, label: "BEGIN" },
  { re: /^commit\b/i, label: "COMMIT" },
  { re: /^rollback\b/i, label: "ROLLBACK" },
  { re: /^abort\b/i, label: "ABORT" },
  { re: /^end\s+(work|transaction)\b/i, label: "END TRANSACTION" },
  { re: /^savepoint\b/i, label: "SAVEPOINT" },
  { re: /^release\b/i, label: "RELEASE" },
];

/**
 * Return the transaction-control statement labels found at STATEMENT LEVEL in a
 * SQL file (empty when clean). The loader rejects any non-empty result: a
 * declarative file must not manage its own transaction, or it could commit
 * partial DDL before a later statement fails (review finding 6). Keywords
 * appearing inside comments, string/dollar-quoted literals, or PG14+
 * `BEGIN ATOMIC` bodies are NOT flagged.
 */
export function findTransactionControl(sql: string): string[] {
  const skeleton = maskLiteralsAndComments(sql);
  const found: string[] = [];
  for (const raw of skeleton.split(";")) {
    const stmt = raw.trim();
    if (stmt === "") continue;
    for (const { re, label } of TXN_CONTROL_RULES) {
      if (re.test(stmt)) {
        found.push(label);
        break;
      }
    }
  }
  return found;
}

/** Statement-leading session-setting forms that change object resolution or
 *  ownership for every statement that follows them on the same session:
 *  `SET search_path` (where unqualified names resolve), `SET ROLE` /
 *  `SET SESSION AUTHORIZATION` (who owns created objects), and the matching
 *  RESETs. `SET LOCAL`/`SET SESSION` modifiers are tolerated. Unrelated GUCs
 *  (e.g. `SET statement_timeout`) are NOT flagged — they don't affect the
 *  extracted schema. */
const SESSION_SETTING_RULES: ReadonlyArray<{ re: RegExp; label: string }> = [
  {
    re: /^set\s+(?:session\s+|local\s+)?search_path\b/i,
    label: "SET search_path",
  },
  {
    // `SET SCHEMA 'x'` is documented as an alias for `SET search_path TO x`.
    re: /^set\s+(?:session\s+|local\s+)?schema\b/i,
    label: "SET SCHEMA",
  },
  { re: /^set\s+(?:session\s+|local\s+)?role\b/i, label: "SET ROLE" },
  {
    re: /^set\s+(?:session\s+|local\s+)?session\s+authorization\b/i,
    label: "SET SESSION AUTHORIZATION",
  },
  {
    re: /^reset\s+(?:role|search_path|session\s+authorization|all)\b/i,
    label: "RESET session setting",
  },
];

/**
 * Return the session-setting statement labels found at STATEMENT LEVEL in a SQL
 * file (empty when clean). The statement-reordering assist (`sql-order.ts`)
 * treats variable `SET`/`RESET` as no-dependency bootstrap statements, so it can
 * move them relative to the DDL they were meant to scope — silently changing the
 * shadow state (e.g. an unqualified `CREATE TABLE` resolving into the wrong
 * schema). The CLI uses this to fall back to raw, file-granular loading (which
 * preserves the authored order) when a directory contains such statements
 * (review P1). Keywords inside comments / string / dollar-quoted literals are
 * NOT flagged (reuses the same literal mask as `findTransactionControl`).
 */
export function findSessionSettingStatements(sql: string): string[] {
  const skeleton = maskLiteralsAndComments(sql);
  const found: string[] = [];
  for (const raw of skeleton.split(";")) {
    const stmt = raw.trim();
    if (stmt === "") continue;
    for (const { re, label } of SESSION_SETTING_RULES) {
      if (re.test(stmt)) {
        found.push(label);
        break;
      }
    }
  }
  return found;
}

/**
 * Return the `ALTER DEFAULT PRIVILEGES` statements found at STATEMENT LEVEL
 * (empty when clean). pg-topo classifies these in its `privileges` phase, which
 * sorts AFTER object creation — but PostgreSQL applies a schema's default
 * privileges to objects created AFTER the `ALTER DEFAULT PRIVILEGES` in authored
 * order. Reordering can therefore move the statement past the `CREATE` it was
 * meant to scope, so the shadow misses the implicit ACLs and the plan diffs the
 * wrong grants. The CLI treats a directory containing one as a reorder barrier
 * and falls back to raw, file-granular loading (review P2). Keywords inside
 * comments / literals are ignored (same literal mask as the others).
 */
export function findDefaultPrivilegeStatements(sql: string): string[] {
  const skeleton = maskLiteralsAndComments(sql);
  const found: string[] = [];
  for (const raw of skeleton.split(";")) {
    if (/^\s*alter\s+default\s+privileges\b/i.test(raw)) {
      found.push("ALTER DEFAULT PRIVILEGES");
    }
  }
  return found;
}

/** The (literal-masked, trimmed) statements in `sql` for which `predicate` is
 *  true. The generic form behind the other scanners — used by the extension
 *  shadow precheck to find a handler's DDL/intent statements without a SQL
 *  grammar (same literal/comment mask, so keywords inside strings are ignored).
 *  Quoted identifiers keep their inner text (`"supabase_vault"` →
 *  ` supabase_vault `) so a precheck can still recognize dump-style
 *  `CREATE EXTENSION IF NOT EXISTS "name"`; comments and string literals stay
 *  blanked. */
export function findMatchingStatements(
  sql: string,
  predicate: (maskedStatement: string) => boolean,
): string[] {
  return maskLiteralsAndComments(sql, { quotedIdentifiers: "keep" })
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "" && predicate(s));
}

/** Cluster-global (not database-local) DDL: role lifecycle, role membership, and
 *  role metadata. `schema apply --scope database` refuses these (or skips them
 *  with `--skip-cluster-ddl`) because roles are shared across the cluster and are
 *  not the declarative source's to manage in that scope. Membership grants are
 *  distinguished from privilege grants by the absence of an `ON` target. */
const CLUSTER_DDL_RULES: { re: RegExp; label: string }[] = [
  // `user(?!\s+mapping)` so `CREATE|ALTER|DROP USER MAPPING …` (a database-local
  // FDW object, emitted by src/plan/rules/foreign.ts) is NOT misclassified as
  // cluster-global role DDL — otherwise database-scope apply would reject them
  // (or --skip-cluster-ddl would strip them) from pg-delta's own exports. `\s+`
  // matches any whitespace run in the masked/normalized statement text.
  {
    re: /^\s*create\s+(role|user(?!\s+mapping)|group)\b/i,
    label: "CREATE ROLE",
  },
  {
    re: /^\s*alter\s+(role|user(?!\s+mapping)|group)\b/i,
    label: "ALTER ROLE",
  },
  { re: /^\s*drop\s+(role|user(?!\s+mapping)|group)\b/i, label: "DROP ROLE" },
  { re: /^\s*comment\s+on\s+role\b/i, label: "COMMENT ON ROLE" },
  {
    re: /^\s*security\s+label\b[\s\S]*\bon\s+role\b/i,
    label: "SECURITY LABEL ON ROLE",
  },
  { re: /^\s*grant\b(?![\s\S]*\bon\b)/i, label: "GRANT (role membership)" },
  { re: /^\s*revoke\b(?![\s\S]*\bon\b)/i, label: "REVOKE (role membership)" },
];

/** Labels of cluster-global DDL statements found at statement level (empty when
 *  clean). Keywords inside comments / literals are ignored (same literal mask as
 *  the other scanners). */
export function findClusterDdlStatements(sql: string): string[] {
  const skeleton = maskLiteralsAndComments(sql);
  const found: string[] = [];
  for (const raw of skeleton.split(";")) {
    const stmt = raw.trim();
    if (stmt === "") continue;
    for (const { re, label } of CLUSTER_DDL_RULES) {
      if (re.test(stmt)) {
        found.push(label);
        break;
      }
    }
  }
  return found;
}

/** Partition `sql` into the statements that are NOT cluster-global DDL (`kept`,
 *  rejoined and ready to load) and the cluster-DDL statements removed
 *  (`skipped`, original text, for the skip ledger). Uses the block-aware
 *  `splitSqlStatements` so function bodies etc. are not mis-split. */
export function stripClusterDdl(sql: string): {
  kept: string;
  skipped: string[];
} {
  const keptParts: string[] = [];
  const skipped: string[] = [];
  for (const stmt of splitSqlStatements(sql)) {
    const masked = maskLiteralsAndComments(stmt).trim();
    if (masked !== "" && CLUSTER_DDL_RULES.some(({ re }) => re.test(masked))) {
      skipped.push(stmt.trim());
    } else {
      keptParts.push(masked === "" ? stmt : `${stmt};`);
    }
  }
  return { kept: keptParts.join("\n"), skipped };
}

export interface SqlFile {
  name: string;
  sql: string;
}

export interface LoadResult {
  factBase: FactBase;
  pgVersion: string;
  diagnostics: Diagnostic[];
  rounds: number;
  /** Managed non-extension tables that already held rows BEFORE the load, as
   *  `"schema"."table"`, and are therefore exempt from the post-load DML
   *  observation. Empty unless `allowPreExistingRows` is in effect (it defaults
   *  to true in `"isolatedCluster"` mode). */
  preExistingPopulatedTables: string[];
}

export class ShadowLoadError extends Error {
  constructor(
    message: string,
    readonly details: Diagnostic[],
  ) {
    super(message);
    this.name = "ShadowLoadError";
  }
}

/** A membership tuple used for snapshot comparison. */
interface MembershipTuple {
  role: string;
  member: string;
  admin_option: boolean;
}

function serializeMembership(m: MembershipTuple): string {
  return `${m.role}:${m.member}:${String(m.admin_option)}`;
}

/**
 * Best-effort undo of any cluster-level role / membership side effect that
 * committed before the load threw (databaseScratch ONLY). Because `applyFile`
 * commits per file, a CREATE ROLE / GRANT — or DO-block dynamic SQL that evaded
 * the static preflight — survives a load that later throws (non-convergence,
 * body-validation, DML, or the on-success leak comparison itself). Compares the
 * current cluster state against the pre-load snapshot and reverses the delta:
 * drop created roles, revoke added memberships, re-grant removed memberships.
 * `applyFile` ROLLBACKs on failure, so `client` is in a clean (non-aborted)
 * transaction state when this runs. Each restore statement is best-effort; a
 * failure is reported as a `scratch_leak_unrestored` diagnostic rather than
 * masking the original error. Successful restores contribute nothing.
 */
async function restoreScratchClusterState(
  client: PoolClient,
  rolesBefore: QueryResult | null,
  membershipsBefore: QueryResult<MembershipTuple> | null,
): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  const rolesNow = await client.query(
    `SELECT rolname FROM pg_roles ORDER BY 1`,
  );
  const membershipsNow = await client.query<MembershipTuple>(`
    SELECT r1.rolname AS role, r2.rolname AS member,
           m.admin_option
    FROM pg_auth_members m
    JOIN pg_roles r1 ON r1.oid = m.roleid
    JOIN pg_roles r2 ON r2.oid = m.member
    ORDER BY 1, 2`);

  const beforeRoleSet = new Set(
    (rolesBefore?.rows ?? []).map((r) => (r as { rolname: string }).rolname),
  );
  const createdRoles = rolesNow.rows
    .map((r) => (r as { rolname: string }).rolname)
    .filter((r) => !beforeRoleSet.has(r));

  const beforeMemberMap = new Map(
    (membershipsBefore?.rows ?? []).map((m) => [serializeMembership(m), m]),
  );
  const nowMemberMap = new Map(
    membershipsNow.rows.map((m) => [serializeMembership(m), m]),
  );
  const addedMemberships = [...nowMemberMap.entries()]
    .filter(([k]) => !beforeMemberMap.has(k))
    .map(([, m]) => m);
  const removedMemberships = [...beforeMemberMap.entries()]
    .filter(([k]) => !nowMemberMap.has(k))
    .map(([, m]) => m);

  const tryRestore = async (stmt: string, what: string): Promise<void> => {
    try {
      await client.query(stmt);
    } catch (err) {
      diags.push({
        code: "scratch_leak_unrestored",
        severity: "error",
        message: `${what}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Revoke added memberships first (a created role may hold them), then drop
  // created roles, then re-grant memberships the load removed.
  for (const m of addedMemberships) {
    await tryRestore(
      `REVOKE ${qid(m.role)} FROM ${qid(m.member)}`,
      `could not revoke leaked membership ${m.role} FROM ${m.member}`,
    );
  }
  for (const role of createdRoles) {
    await tryRestore(
      `DROP ROLE IF EXISTS ${qid(role)}`,
      `could not drop leaked role ${role}`,
    );
  }
  for (const m of removedMemberships) {
    await tryRestore(
      `GRANT ${qid(m.role)} TO ${qid(m.member)}${m.admin_option ? " WITH ADMIN OPTION" : ""}`,
      `could not restore revoked membership ${m.role} TO ${m.member}`,
    );
  }
  return diags;
}

/**
 * Qualified (`"schema"."table"`) names of the managed non-extension tables that
 * currently hold at least one row. This is the ONE query behind both the pre-load
 * exemption snapshot and the post-load DML observation, so the exemption is exact
 * string-set subtraction (identical scope, identical escaping).
 *
 * "Managed user table" must mean the SAME thing the diff path manages, so reuse
 * the extraction scope predicate (USER_SCHEMA_FILTER drops pg_catalog /
 * information_schema / pg_toast / pg_temp) and exclude extension-owned relations
 * (pg_depend deptype 'e'). Otherwise a declarative file that installs an
 * extension whose CREATE EXTENSION seeds internal config rows — or a platform
 * object — is wrongly read as if the user wrote DML (P2).
 */
async function listPopulatedManagedTables(
  db: Pick<PoolClient, "query">,
): Promise<string[]> {
  const tables = await db.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}`);
  const populated: string[] = [];
  for (const row of tables.rows as { schema: string; name: string }[]) {
    const qualified = `"${row.schema.replaceAll('"', '""')}"."${row.name.replaceAll('"', '""')}"`;
    const r = await db.query(
      `SELECT EXISTS (SELECT 1 FROM ${qualified} LIMIT 1) AS has`,
    );
    if ((r.rows[0] as { has: boolean }).has) populated.push(qualified);
  }
  return populated;
}

export interface LoadSqlFilesOptions {
  maxRounds?: number;
  mode?: "databaseScratch" | "isolatedCluster";
  /** Extractor for the loaded shadow state. Defaults to the raw core
   *  `extract`; a profile-aware caller passes its `ctx.extract` so the shadow
   *  desired state is projected with the SAME handlers as the target (review
   *  P1 — SQL-file workflows must match the profile-aware DB-to-DB path). */
  extract?: (pool: Pool, options?: ExtractOptions) => Promise<ExtractResult>;
  /** Assumed schemas the caller PRE-SEEDED into the shadow (Phase 2b): the
   *  emptiness guard below excludes them from its count so a deliberately
   *  seeded shadow (auth.users under --profile supabase) is not rejected as
   *  "not empty". Only these schemas are exempt — an unexpected object
   *  anywhere else still fails the guard. */
  seededSchemas?: string[];
  /** Encoded stable ids of the routines the Phase 2b seed ACTUALLY created,
   *  mapped to each routine's seeded `pg_get_functiondef` text. Scopes the
   *  post-load body-validation leniency: a routine is treated as
   *  "seeded platform code" (warn on a wonky body) only when its overload-safe
   *  encoded identity is in this map AND its current def is unchanged from the
   *  seeded def. A user-authored routine in a seeded schema — a new overload,
   *  or a CREATE OR REPLACE that changes the body — is NOT in (or no longer
   *  matches) this map and THROWS (Codex #329). When OMITTED (direct library
   *  callers), leniency falls back to the coarser `seededSchemas` name check
   *  for backward compatibility; the CLI always passes this once it seeds. */
  seededRoutines?: ReadonlyMap<string, string>;
  /** Escalate a USER routine's post-load body-validation failure back to a
   *  fatal error (default `false`). By default a user routine whose body fails
   *  the `check_function_bodies = on` re-lint is reported as a loud WARNING and
   *  the load proceeds: Postgres already accepted it under check-off (which
   *  pg-delta's own apply executor emits in every plan preamble), so refusing
   *  to read it back would be pg-delta imposing stricter validation than
   *  Postgres and would block round-tripping any schema that relies on
   *  check-off. Set to `true` (CLI `--strict-function-bodies`) to restore the
   *  fatal gate for CI. Only class-3 (user-schema) failures honour this flag —
   *  a routine in a seeded schema that is NOT an unchanged seed always throws
   *  (Codex #329), and an unchanged seeded routine always warns. */
  strictFunctionBodies?: boolean;
  /** Tolerate rows that already existed in the shadow BEFORE this load
   *  (default: `true` in `"isolatedCluster"` mode, `false` otherwise). A
   *  dedicated shadow may be pre-provisioned by a platform — the Supabase CLI
   *  boots auth / storage / realtime against it, and those services write their
   *  own migration bookkeeping rows — long before declarative SQL is loaded.
   *  When enabled the loader snapshots which managed non-extension tables are
   *  populated before the load and exempts exactly those from the post-load DML
   *  observation, silently; the exempted set is returned as
   *  {@link LoadResult.preExistingPopulatedTables}. Exemption is by qualified
   *  table NAME (no data comparison, ever), so a pre-populated table stays
   *  exempt even if a declarative file inserts into it — an accepted limitation
   *  of observing rather than parsing. */
  allowPreExistingRows?: boolean;
  /** Escalate the post-load DML observation back to a fatal error (default
   *  `false`). By default a managed non-extension table holding rows the load
   *  cannot account for is a loud `data_statement` WARNING and the load
   *  proceeds: pg-delta only diffs schema, so incidental data cannot corrupt a
   *  plan, and refusing to read the schema back would block every directory
   *  that carries some. Set to `true` (CLI `--strict-data-statements`) to
   *  restore the `ShadowLoadError` refusal for CI. Pre-existing rows exempted
   *  by `allowPreExistingRows` are never escalated — they are not observed at
   *  all. Library default remains `false` (warning); a schema-first / Supabase
   *  CLI adapter must pass `true` so declarative DML is rejected rather than
   *  warned. */
  strictDataStatements?: boolean;
}

export async function loadSqlFiles(
  files: SqlFile[],
  shadow: Pool,
  options: LoadSqlFilesOptions = {},
): Promise<LoadResult> {
  // Rounds scale with dependency DEPTH, not file count: each round resolves
  // every file whose dependencies now exist. A deterministic, convergent load
  // therefore needs at most `files.length` rounds (worst case — a fully
  // reverse-ordered linear chain resolves one file per round); the zero-progress
  // check below fails genuine non-convergence (missing object, cycle) IMMEDIATELY
  // with the real per-file errors. So `maxRounds` is purely an oscillation
  // backstop for non-deterministic SQL, NOT a depth limit — it must scale with
  // the file count (floor 25 preserves the small-schema default). A fixed 25
  // used to wrongly fail any chain deeper than 25 that was still making progress.
  const maxRounds = options.maxRounds ?? Math.max(files.length + 1, 25);
  const mode = options.mode ?? "databaseScratch";
  const extractShadow = options.extract ?? extract;

  // the shadow must be empty — verify by observation. Schemas the caller
  // pre-seeded (Phase 2b assumed schemas) are exempt: they were deliberately
  // populated before this load, and `<> ALL(ARRAY[]::text[])` is TRUE for every
  // row when nothing was seeded, so the default (unseeded) path is unchanged.
  const seededSchemas = options.seededSchemas ?? [];
  const seededRoutines = options.seededRoutines;
  const strictFunctionBodies = options.strictFunctionBodies ?? false;
  const strictDataStatements = options.strictDataStatements ?? false;
  // A dedicated (isolatedCluster) shadow may legitimately arrive pre-provisioned
  // with a platform baseline whose services already wrote bookkeeping rows — the
  // Supabase CLI declarative seam. A co-located scratch database never can (the
  // emptiness guard below already forbids it), so default the tolerance to the
  // mode and let an explicit option override either way.
  const allowPreExistingRows =
    options.allowPreExistingRows ?? mode === "isolatedCluster";
  // isolatedCluster shadows may already carry a platform baseline (e.g. the
  // Supabase CLI declarative seam). The empty guard is for co-located scratch
  // databases only — requiring emptiness there prevents accidental loads into
  // a non-scratch database on a shared cluster.
  if (mode !== "isolatedCluster") {
    const preexisting = await shadow.query(
      `
    SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
      AND n.nspname <> ALL($1::text[])`,
      [seededSchemas],
    );
    if ((preexisting.rows[0] as { n: number }).n > 0) {
      throw new ShadowLoadError("shadow database is not empty", []);
    }
  }

  // Snapshot which managed tables ALREADY hold rows, before a single file runs
  // (mirrors the rolesBefore / membershipsBefore snapshots below). Those tables
  // are fully exempt from the post-load DML observation: their rows pre-date the
  // declarative files, so attributing them to the user's SQL would be wrong.
  // Exemption is exact string-set subtraction against the identical query.
  const preExistingPopulatedTables = allowPreExistingRows
    ? await listPopulatedManagedTables(shadow)
    : [];
  const preExistingPopulatedSet = new Set(preExistingPopulatedTables);

  // reject files that manage their own transaction (review finding 6): an
  // explicit COMMIT/BEGIN/SAVEPOINT/… would break the per-file atomic wrapper
  // below, letting partial DDL commit before a later statement fails.
  const txnControlDiags: Diagnostic[] = [];
  for (const file of files) {
    const offenders = findTransactionControl(file.sql);
    if (offenders.length > 0) {
      txnControlDiags.push({
        code: "transaction_control",
        severity: "error",
        message: `${file.name}: declarative SQL must not contain transaction-control statements (found: ${[...new Set(offenders)].join(", ")})`,
      });
    }
  }
  if (txnControlDiags.length > 0) {
    throw new ShadowLoadError(
      `declarative files must not manage transactions — ${txnControlDiags.length} file(s) contain transaction-control statements`,
      txnControlDiags,
    );
  }

  // cluster-DDL preflight (databaseScratch ONLY): role / membership DDL leaks
  // into the shared cluster because each file commits (BEGIN/COMMIT in
  // applyFile). Refuse it BEFORE executing anything so a committed CREATE ROLE
  // / GRANT can never survive. This is a static (regex-masked) precheck; DO-block
  // dynamic SQL that evades it is caught + reversed by the post-load snapshot
  // comparison and the best-effort restore below. isolatedCluster mode manages
  // cluster state legitimately and skips this preflight entirely.
  if (mode === "databaseScratch") {
    const clusterDdlDiags: Diagnostic[] = [];
    for (const file of files) {
      const offenders = findClusterDdlStatements(file.sql);
      if (offenders.length > 0) {
        clusterDdlDiags.push({
          code: "cluster_ddl_in_scratch_mode",
          severity: "error",
          message: `${file.name}: declarative SQL must not contain cluster-level DDL in databaseScratch mode (found: ${[...new Set(offenders)].join(", ")}) — use an isolated-cluster shadow for shared objects`,
        });
      }
    }
    if (clusterDdlDiags.length > 0) {
      throw new ShadowLoadError(
        `declarative files contain cluster-level DDL not allowed in databaseScratch mode — ${clusterDdlDiags.length} file(s) affected; use an isolated-cluster shadow for shared objects`,
        clusterDdlDiags,
      );
    }
  }

  // snapshot pg_roles + pg_auth_members before loading (databaseScratch only)
  const rolesBefore =
    mode === "databaseScratch"
      ? await shadow.query(`SELECT rolname FROM pg_roles ORDER BY 1`)
      : null;
  const membershipsBefore =
    mode === "databaseScratch"
      ? await shadow.query<MembershipTuple>(`
          SELECT r1.rolname AS role, r2.rolname AS member,
                 m.admin_option
          FROM pg_auth_members m
          JOIN pg_roles r1 ON r1.oid = m.roleid
          JOIN pg_roles r2 ON r2.oid = m.member
          ORDER BY 1, 2`)
      : null;

  // bounded retry rounds at file granularity (fail-safe ordering)
  let pending = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
  let rounds = 0;
  // body-validation warnings for SEEDED-schema routines (populated below,
  // outside the try/finally so the final result can merge them in).
  let seededBodyWarnings: Diagnostic[] = [];
  // non-fatal `data_statement` observations (same lifetime rationale).
  let dataStatementWarnings: Diagnostic[] = [];
  // the most recent round's per-file failures, retained so a budget-exhaustion
  // error can report WHY each still-pending file failed (review P1 #2).
  let lastFailures: Array<{ file: SqlFile; message: string }> = [];
  // per-file count of CONSECUTIVE rounds a file failed with the SAME message, so
  // a stuck / non-converged error can say "failed identically in N round(s)" —
  // a file whose error never changes is a genuine missing dependency (or cycle),
  // not something more rounds will resolve.
  const failStreak = new Map<string, { message: string; count: number }>();
  let bootstrapMembershipStrip: {
    roles: ReadonlySet<string>;
    member: string;
  } | null = null;
  const client = await shadow.connect();
  try {
    await client.query(`SET check_function_bodies = off`);
    // PG 16+: CREATE ROLE no longer auto-grants the creator membership in the
    // new role. Supabase's non-superuser `postgres` (CREATEROLE) then fails
    // `CREATE SCHEMA … AUTHORIZATION new_role` with "must be able to SET ROLE"
    // unless createrole_self_grant includes `set`. Best-effort — the GUC is
    // absent on PG < 16, where creators still receive membership automatically.
    //
    // Those bootstrap memberships must NOT survive into the extracted desired
    // state: planning them yields `GRANT role TO postgres WITH ADMIN OPTION`,
    // which fails on apply with "ADMIN option cannot be granted back to your
    // own grantor" (the applier is already the CREATE ROLE grantor).
    let createroleSelfGrant = false;
    try {
      await client.query(
        `SELECT set_config('createrole_self_grant', 'set, inherit', false)`,
      );
      createroleSelfGrant = true;
    } catch {
      /* PG < 16 or GUC unavailable */
    }
    const rolesBeforeSelfGrant =
      createroleSelfGrant && mode === "isolatedCluster"
        ? await client.query(`SELECT rolname FROM pg_roles ORDER BY 1`)
        : null;
    while (pending.length > 0) {
      // Budget exhausted with files still pending: fail LOUD, never fall through
      // to extraction with a partially loaded shadow (review P1 #2). The SQL-file
      // frontend's contract is all-or-error — a caller must never receive a fact
      // base that silently omits declarative files that did not converge.
      if (rounds >= maxRounds) {
        throw new ShadowLoadError(
          `shadow load did not converge within maxRounds=${maxRounds}: ${pending.length} file(s) still pending (${pending.map((f) => f.name).join(", ")})`,
          pending.map((f) => {
            const failure = lastFailures.find((x) => x.file.name === f.name);
            return {
              code: "max_rounds_exceeded",
              severity: "error",
              message: failure
                ? `${f.name}: ${failure.message}`
                : `${f.name}: still pending after ${rounds} round(s)`,
            };
          }),
        );
      }
      rounds++;
      const failures: Array<{ file: SqlFile; message: string }> = [];
      const next: SqlFile[] = [];
      for (const file of pending) {
        try {
          await applyFile(client, file.sql);
        } catch (error) {
          // A ShadowLoadError from applyFile is a deterministic policy refusal
          // (mixed non-transactional file, or a non-allowlisted non-transactional
          // statement) — retrying in a later round can never make it succeed, so
          // surface it immediately with its own message instead of deferring it
          // until the round budget or a "stuck" round wraps it.
          if (error instanceof ShadowLoadError) throw error;
          const message = describeFileFailure(file.sql, error);
          const prev = failStreak.get(file.name);
          failStreak.set(file.name, {
            message,
            count:
              prev !== undefined && prev.message === message
                ? prev.count + 1
                : 1,
          });
          failures.push({ file, message });
          next.push(file);
        }
      }
      if (next.length === pending.length) {
        // no progress: stuck — inspect for mutual-FK situation, then fail loud
        const mutualFkHint = detectMutualFk(failures)
          ? " Tip: if two tables reference each other with inline REFERENCES clauses, split one foreign key into a separate ALTER TABLE … ADD CONSTRAINT statement."
          : "";
        throw new ShadowLoadError(
          `shadow load stuck after ${rounds} round(s): ${next.length} file(s) cannot apply${mutualFkHint}`,
          failures.map((f) => {
            const streak = failStreak.get(f.file.name);
            const streakNote =
              streak !== undefined && streak.count > 1
                ? ` (failed identically in ${streak.count} round(s) — likely a genuine missing dependency, not ordering)`
                : "";
            return {
              code: "stuck_statement",
              severity: "error",
              message: `${f.file.name}: ${f.message}${streakNote}`,
            };
          }),
        );
      }
      lastFailures = failures;
      pending = next;
    }

    // Capture createrole_self_grant bootstrap grants for post-extract stripping.
    // REVOKE is insufficient: PG may leave an ADMIN membership whose grantor is
    // the role that conferred CREATEROLE (not CURRENT_USER), which the applier
    // cannot revoke — yet planning that membership yields a failing
    // `GRANT … TO <applier> WITH ADMIN OPTION` on apply.
    if (rolesBeforeSelfGrant !== null) {
      const rolesAfterSelfGrant = await client.query(
        `SELECT rolname FROM pg_roles ORDER BY 1`,
      );
      const beforeSet = new Set(
        rolesBeforeSelfGrant.rows.map(
          (r) => (r as { rolname: string }).rolname,
        ),
      );
      const createdRoles = rolesAfterSelfGrant.rows
        .map((r) => (r as { rolname: string }).rolname)
        .filter((r) => !beforeSet.has(r));
      const me = await client.query<{ u: string }>(`SELECT current_user AS u`);
      bootstrapMembershipStrip = {
        roles: new Set(createdRoles),
        member: me.rows[0]!.u,
      };
    }

    // shared-object isolation: role/membership leakage is an error in databaseScratch mode
    if (mode === "databaseScratch") {
      const rolesAfter = await client.query(
        `SELECT rolname FROM pg_roles ORDER BY 1`,
      );
      const beforeRoleSet = new Set(
        (rolesBefore?.rows ?? []).map(
          (r) => (r as { rolname: string }).rolname,
        ),
      );
      const afterRoleSet = new Set(
        rolesAfter.rows.map((r) => (r as { rolname: string }).rolname),
      );
      // symmetric: a CREATE ROLE (after∖before) AND a DROP ROLE (before∖after)
      // are both cluster-level side effects in shared-scratch mode (review P1).
      const createdRoles = [...afterRoleSet].filter(
        (r) => !beforeRoleSet.has(r),
      );
      const droppedRoles = [...beforeRoleSet].filter(
        (r) => !afterRoleSet.has(r),
      );
      if (createdRoles.length > 0 || droppedRoles.length > 0) {
        const parts = [
          createdRoles.length > 0 ? `created: ${createdRoles.join(", ")}` : "",
          droppedRoles.length > 0 ? `dropped: ${droppedRoles.join(", ")}` : "",
        ].filter(Boolean);
        throw new ShadowLoadError(
          `declarative files changed cluster-level roles (${parts.join("; ")}) — use an isolated-cluster shadow for shared objects`,
          [...createdRoles, ...droppedRoles].map((r) => ({
            code: "shared_object_leak",
            severity: "error",
            subject: { kind: "role", name: r },
            message: `role ${r} changed out of the shadow database`,
          })),
        );
      }

      // membership snapshot comparison: detect GRANT role_a TO role_b leaks
      const membershipsAfter = await client.query<MembershipTuple>(`
        SELECT r1.rolname AS role, r2.rolname AS member,
               m.admin_option
        FROM pg_auth_members m
        JOIN pg_roles r1 ON r1.oid = m.roleid
        JOIN pg_roles r2 ON r2.oid = m.member
        ORDER BY 1, 2`);
      // symmetric over the serialized rows (which include admin_option): a GRANT
      // (after∖before), a REVOKE (before∖after), and an admin_option change (which
      // appears as one of each) are all cluster-level side effects (review P1).
      const beforeMemberSet = new Set(
        (membershipsBefore?.rows ?? []).map(serializeMembership),
      );
      const afterMemberSet = new Set(
        membershipsAfter.rows.map(serializeMembership),
      );
      const grants = membershipsAfter.rows.filter(
        (m) => !beforeMemberSet.has(serializeMembership(m)),
      );
      const revokes = (membershipsBefore?.rows ?? []).filter(
        (m) => !afterMemberSet.has(serializeMembership(m)),
      );
      if (grants.length > 0 || revokes.length > 0) {
        const describe = (
          m: MembershipTuple,
          verb: "GRANT" | "REVOKE",
        ): string =>
          `${verb} ${m.role} ${verb === "GRANT" ? "TO" : "FROM"} ${m.member}${m.admin_option ? " WITH ADMIN OPTION" : ""}`;
        const descriptions = [
          ...grants.map((m) => describe(m, "GRANT")),
          ...revokes.map((m) => describe(m, "REVOKE")),
        ];
        throw new ShadowLoadError(
          `declarative files modified cluster-level membership (${descriptions.join(", ")}) — use an isolated-cluster shadow for shared objects`,
          descriptions.map((d) => ({
            code: "shared_object_leak",
            severity: "error",
            message: `membership leak: ${d}`,
          })),
        );
      }
    }

    // body validation: re-run routine definitions with checks ON.
    // `check_function_bodies` only validates sql/plpgsql bodies — per the
    // Postgres docs, it "has no effect on ... functions written in languages
    // other than SQL and PL/pgSQL, whose bodies are not checked". Re-running a
    // non-sql/plpgsql routine (internal/c, or any other procedural language)
    // therefore adds no coverage, and can actively break the load: e.g.
    // `CREATE TYPE ... AS RANGE (...)` auto-creates `LANGUAGE internal`
    // constructor/support functions, and re-running those as
    // `CREATE OR REPLACE FUNCTION ... LANGUAGE internal` fails with
    // "permission denied for language internal" for a non-superuser role.
    // `identity_args` reuses the EXACT `format_type(unnest(proargtypes))`
    // expression extraction uses (src/extract/routines.ts) so the encoded
    // `StableId` reconstructed per row matches the seed's `seededRoutines` keys
    // byte-for-byte — the leniency gate is by overload-safe identity, not name.
    // format_type's output is search_path-sensitive, and extraction runs under
    // the canonical `search_path = pg_catalog` (everything else comes back
    // schema-qualified) — so this query must run under the SAME path or a
    // user-type arg (`hstore` vs `public.hstore`) breaks the byte-for-byte key
    // match. Scope the canonical path to this query alone via a transaction:
    // body re-validation below must keep the session's own path so bodies
    // resolve as they would at apply time.
    // No pgMajor is threaded through to this frontend from extraction, so this
    // is a dedicated round trip (unlike extract.ts, which already probes
    // version metadata for ExtractResult.pgVersion and reuses it here for
    // free) — see the jit guard below for why the major version is needed.
    const pgMajorRow = await client.query(
      `SELECT current_setting('server_version_num')::int AS num`,
    );
    const pgMajor = Math.floor(
      (pgMajorRow.rows[0] as { num: number }).num / 10000,
    );

    await client.query(`BEGIN`);
    await client.query(`SET LOCAL search_path TO 'pg_catalog'`);
    // JIT is pure per-execution overhead for catalog-only queries; mirrors the
    // extraction transaction's jit guard (src/extract/extract.ts — see its
    // comment for detail, including the postgres-hackers caveat that
    // PGC_USERSET params like `jit` aren't actually gated by the parameter
    // ACL at the SET call site). On PG >= 15, guard behind
    // `has_parameter_privilege` (never throws) rather than a bare
    // `SET LOCAL jit = off`: a failed statement poisons this WHOLE
    // transaction, so it must never be able to error. PG 14 has neither the
    // function nor parameter ACLs, so the plain SET LOCAL is used there
    // unconditionally.
    await client.query(
      pgMajor >= 15
        ? "SELECT set_config('jit', 'off', true) WHERE has_parameter_privilege(current_user, 'jit', 'SET')"
        : "SET LOCAL jit = off",
    );
    const defs = await client.query(`
      SELECT n.nspname AS nspname, p.proname AS proname, p.prokind AS prokind,
             ARRAY(SELECT format_type(t.t, NULL)
                   FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                   ORDER BY t.ord)::text[] AS identity_args,
             pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE p.prokind IN ('f', 'p')
        AND l.lanname IN ('sql', 'plpgsql')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`);
    await client.query(`COMMIT`);
    await client.query(`SET check_function_bodies = on`);
    const bodyErrors: Diagnostic[] = [];
    const bodyWarnings: Diagnostic[] = [];
    for (const row of defs.rows as {
      nspname: string;
      proname: string;
      prokind: string;
      identity_args: string[];
      def: string;
    }[]) {
      try {
        await client.query(row.def);
      } catch (error) {
        const message = `${row.nspname}.${row.proname}: ${error instanceof Error ? error.message : String(error)}`;
        // Three-way classification of a post-load body-validation failure:
        //
        // 1. SEEDED, UNCHANGED (identity + def byte-match a seed; or, when
        //    `seededRoutines` is omitted by a direct library caller, any routine
        //    whose schema NAME is seeded — the coarse legacy fallback): WARNING
        //    with the distinct `invalid_seeded_routine_body` code. Seeded platform
        //    routines are reference-only on both sides of the diff (they cancel,
        //    so a wonky seeded body cannot corrupt the plan) and are not the
        //    user's code to fail their apply on. Surfaced (not swallowed) because
        //    such a failure has previously exposed a real engine bug in
        //    platform-code reconstruction. NEVER escalated by strict mode.
        //
        // 2. SEEDED SCHEMA, NOT AN UNCHANGED SEED (a new overload, or a
        //    CREATE OR REPLACE that changed the body): FATAL. Assumed-schema
        //    facts are reference-only in the diff, so a declared change here would
        //    be a silent no-op — failing loud is a coverage guarantee (Codex
        //    #329). Ignores strict mode (always throws).
        //
        // 3. USER ROUTINE (schema NOT seeded): WARNING by default. Postgres
        //    accepted it under check-off (which pg-delta's own apply executor
        //    emits), so apply will faithfully materialise exactly what was
        //    declared — refusing to read it back would be pg-delta imposing
        //    stricter validation than Postgres. Escalated to FATAL only under
        //    `strictFunctionBodies` (CLI `--strict-function-bodies`).
        const inSeededSchema = seededSchemas.includes(row.nspname);
        const isUnchangedSeed =
          seededRoutines === undefined
            ? inSeededSchema
            : ((): boolean => {
                const id: StableId = {
                  kind: row.prokind === "p" ? "procedure" : "function",
                  schema: row.nspname,
                  name: row.proname,
                  args: (row.identity_args as string[]).map(String),
                };
                const seededDef = seededRoutines.get(encodeId(id));
                return seededDef !== undefined && seededDef === row.def;
              })();
        if (isUnchangedSeed) {
          // class 1
          bodyWarnings.push({
            code: "invalid_seeded_routine_body",
            severity: "warning",
            message,
          });
        } else if (inSeededSchema) {
          // class 2 — always fatal (Codex #329)
          bodyErrors.push({
            code: "invalid_routine_body",
            severity: "error",
            message,
          });
        } else if (strictFunctionBodies) {
          // class 3 under strict opt-in — fatal
          bodyErrors.push({
            code: "invalid_routine_body",
            severity: "error",
            message,
          });
        } else {
          // class 3 default — loud warning, load proceeds
          bodyWarnings.push({
            code: "invalid_routine_body",
            severity: "warning",
            message,
          });
        }
      }
    }
    if (bodyErrors.length > 0) {
      throw new ShadowLoadError(
        `${bodyErrors.length} routine bod${bodyErrors.length === 1 ? "y" : "ies"} failed validation`,
        bodyErrors,
      );
    }
    seededBodyWarnings = bodyWarnings;

    // DML observation: report every MANAGED USER table that holds rows, minus the
    // tables that already held rows before the load (see the pre-load snapshot).
    // Tables exempted there are dropped SILENTLY — their rows are not the user's
    // DML, so there is nothing to tell the caller about.
    const populated = (await listPopulatedManagedTables(client)).filter(
      (t) => !preExistingPopulatedSet.has(t),
    );
    if (populated.length > 0) {
      // FATAL only under the strictDataStatements opt-in. By default this is a
      // loud warning and the load proceeds: pg-delta diffs schema only, so rows
      // in the shadow cannot corrupt the plan, and refusing to read the schema
      // back would block every directory that carries incidental data.
      const details: Diagnostic[] = populated.map((t) => ({
        code: "data_statement",
        severity: strictDataStatements ? "error" : "warning",
        message: `managed user table ${t} contains rows after loading the declarative files`,
      }));
      if (strictDataStatements) {
        throw new ShadowLoadError(
          `declarative files must not contain data statements — rows found in managed user table(s): ${populated.join(", ")}`,
          details,
        );
      }
      dataStatementWarnings = details;
    }
  } catch (err) {
    // Best-effort containment of any cluster-level leak that committed before the
    // throw (databaseScratch only): per-file COMMIT means a CREATE ROLE / GRANT —
    // or DO-block dynamic SQL that evaded the static preflight, detected by the
    // on-success snapshot comparison above — survives an aborted load. Reverse it
    // BEFORE the finally releases the pooled client. `applyFile` ROLLBACKs on
    // failure, so `client` is in a clean transaction state here.
    if (mode === "databaseScratch") {
      const restoreDiags = await restoreScratchClusterState(
        client,
        rolesBefore,
        membershipsBefore,
      );
      if (restoreDiags.length > 0 && err instanceof ShadowLoadError) {
        err.details.push(...restoreDiags);
      }
    }
    throw err;
  } finally {
    // restore the GUC even when load fails early (before the on-success reset
    // at the body-validation step) — otherwise the pooled client returns with
    // check_function_bodies still off (review P2).
    await client.query(`RESET check_function_bodies`).catch(() => {});
    client.release();
  }

  // provenance tag: mark the fact base as originating from SQL files. The
  // extractor is profile-aware when the caller supplied one (handler-aware
  // projection), else the raw core extractor.
  const result = await extractShadow(shadow, { source: "sqlFiles" });
  let factBase = result.factBase;
  if (
    bootstrapMembershipStrip !== null &&
    bootstrapMembershipStrip.roles.size > 0
  ) {
    const strip = bootstrapMembershipStrip;
    const drop = (id: StableId): boolean =>
      id.kind === "membership" &&
      strip.roles.has(id.role) &&
      id.member === strip.member;
    const facts = factBase.facts().filter((f) => !drop(f.id));
    const kept = new Set(facts.map((f) => encodeId(f.id)));
    const edges = [...factBase.edges].filter(
      (e) => kept.has(encodeId(e.from)) && kept.has(encodeId(e.to)),
    );
    factBase = buildFactBase(
      facts,
      edges,
      factBase.source,
      factBase.referenceOnly,
    );
  }
  return {
    factBase,
    pgVersion: result.pgVersion,
    diagnostics: [
      ...result.diagnostics,
      ...seededBodyWarnings,
      ...dataStatementWarnings,
    ],
    rounds,
    preExistingPopulatedTables,
  };
}

/**
 * Heuristic: detect whether stuck files are likely suffering from a mutual
 * inline FK cycle (two CREATE TABLEs each referencing the other's table inline).
 *
 * We look for: ≥2 stuck files whose PG errors mention "relation … does not
 * exist" or "foreign key constraint … references table" against a table name
 * that another stuck file would create.
 */
function detectMutualFk(
  failures: Array<{ file: SqlFile; message: string }>,
): boolean {
  if (failures.length < 2) return false;

  // Extract table names that each file attempts to CREATE TABLE
  const tablePattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|[\w.]+)/gi;
  const fkErrorPattern =
    /relation "([^"]+)" does not exist|foreign key constraint .* references table "([^"]+)"/i;

  const filesThatCreate = new Map<string, Set<string>>();
  for (const f of failures) {
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    tablePattern.lastIndex = 0;
    while ((m = tablePattern.exec(f.file.sql)) !== null) {
      // strip schema prefix and quotes for simple matching
      const raw = m[0]
        .replace(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "")
        .trim();
      const bare =
        raw
          .replace(/^"([^"]+)"$/, "$1")
          .split(".")
          .pop() ?? raw;
      names.add(bare.toLowerCase());
    }
    filesThatCreate.set(f.file.name, names);
  }

  // Check whether any stuck file's error mentions a table that another stuck
  // file would create (i.e. cross-file unresolved reference)
  const allCreated = new Set<string>();
  for (const names of filesThatCreate.values()) {
    for (const n of names) allCreated.add(n);
  }

  for (const f of failures) {
    const em = fkErrorPattern.exec(f.message);
    if (!em) continue;
    const missing = (em[1] ?? em[2] ?? "").toLowerCase().split(".").pop() ?? "";
    if (missing && allCreated.has(missing)) return true;
  }

  return false;
}
