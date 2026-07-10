/**
 * Stage 7: the shadow-DB frontend — SQL files → fact base
 * (target-architecture §3.2). Parser-free by design:
 * - ordering: bounded retry rounds at FILE granularity against the shadow
 *   (fail-safe — errors surface before anything is extracted)
 * - body validation: routines re-validated with checks ON after loading
 * - shared-object isolation: pg_roles + pg_auth_members snapshot before/after;
 *   leakage fails in "databaseScratch" mode (skipped in "isolatedCluster" mode)
 * - DML rejection: any user table containing rows fails, by observation
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
 * tooling usage where one cluster hosts many test databases.
 *
 * ### "isolatedCluster"
 * The shadow database has its own dedicated PostgreSQL cluster (e.g. from
 * isolatedClusterPair()). Because no other database shares that cluster,
 * role/membership side-effects are confined and harmless. The shared-object
 * snapshot check is SKIPPED entirely; files that CREATE ROLE or GRANT role
 * memberships will load successfully. Use this mode when your SQL files
 * intentionally manage cluster-level state.
 */
import type { Pool, PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { FactBase } from "../core/fact.ts";
import {
  extract,
  type ExtractOptions,
  type ExtractResult,
} from "../extract/extract.ts";
import { notExtensionMember, USER_SCHEMA_FILTER } from "../extract/scope.ts";
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
function maskLiteralsAndComments(sql: string): string {
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
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') {
          i++;
          break;
        } else i++;
      }
      out.push(" ");
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
 *  grammar (same literal/comment mask, so keywords inside strings are ignored). */
export function findMatchingStatements(
  sql: string,
  predicate: (maskedStatement: string) => boolean,
): string[] {
  return maskLiteralsAndComments(sql)
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
  { re: /^\s*create\s+(role|user|group)\b/i, label: "CREATE ROLE" },
  { re: /^\s*alter\s+(role|user|group)\b/i, label: "ALTER ROLE" },
  { re: /^\s*drop\s+(role|user|group)\b/i, label: "DROP ROLE" },
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

export async function loadSqlFiles(
  files: SqlFile[],
  shadow: Pool,
  options: {
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
  } = {},
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
  // the most recent round's per-file failures, retained so a budget-exhaustion
  // error can report WHY each still-pending file failed (review P1 #2).
  let lastFailures: Array<{ file: SqlFile; message: string }> = [];
  // per-file count of CONSECUTIVE rounds a file failed with the SAME message, so
  // a stuck / non-converged error can say "failed identically in N round(s)" —
  // a file whose error never changes is a genuine missing dependency (or cycle),
  // not something more rounds will resolve.
  const failStreak = new Map<string, { message: string; count: number }>();
  const client = await shadow.connect();
  try {
    await client.query(`SET check_function_bodies = off`);
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

    // body validation: re-run routine definitions with checks ON
    const defs = await client.query(`
      SELECT n.nspname AS nspname, p.proname AS proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prokind IN ('f', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`);
    await client.query(`SET check_function_bodies = on`);
    const bodyErrors: Diagnostic[] = [];
    const bodyWarnings: Diagnostic[] = [];
    for (const row of defs.rows as {
      nspname: string;
      proname: string;
      def: string;
    }[]) {
      try {
        await client.query(row.def);
      } catch (error) {
        const message = `${row.nspname}.${row.proname}: ${error instanceof Error ? error.message : String(error)}`;
        // Seeded platform routines (Phase 2b assumed schemas) are reference-only
        // on both sides of the diff — they cancel, so a wonky seeded body cannot
        // corrupt the plan — and they are not the user's code to fail their
        // apply on. Still surface it as a warning rather than swallowing it: a
        // seeded-routine validation failure has previously exposed a real
        // engine bug in platform-code reconstruction.
        if (seededSchemas.includes(row.nspname)) {
          bodyWarnings.push({
            code: "invalid_routine_body",
            severity: "warning",
            message,
          });
        } else {
          bodyErrors.push({
            code: "invalid_routine_body",
            severity: "error",
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

    // DML rejection by observation: any MANAGED USER table with rows fails.
    // "User table" must mean the SAME thing the diff path manages, so reuse the
    // extraction scope predicate (USER_SCHEMA_FILTER drops pg_catalog /
    // information_schema / pg_toast / pg_temp) and exclude extension-owned
    // relations (pg_depend deptype 'e'). Otherwise a declarative file that
    // installs an extension whose CREATE EXTENSION seeds internal config rows —
    // or a platform object — is wrongly rejected as if the user wrote DML (P2).
    const tables = await client.query(`
      SELECT n.nspname AS schema, c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND ${USER_SCHEMA_FILTER}
        AND ${notExtensionMember("pg_class", "c.oid")}`);
    const populated: string[] = [];
    for (const row of tables.rows as { schema: string; name: string }[]) {
      const qualified = `"${row.schema.replaceAll('"', '""')}"."${row.name.replaceAll('"', '""')}"`;
      const r = await client.query(
        `SELECT EXISTS (SELECT 1 FROM ${qualified} LIMIT 1) AS has`,
      );
      if ((r.rows[0] as { has: boolean }).has) populated.push(qualified);
    }
    if (populated.length > 0) {
      throw new ShadowLoadError(
        `declarative files must not contain data statements — rows found in managed user table(s): ${populated.join(", ")}`,
        populated.map((t) => ({
          code: "data_statement",
          severity: "error",
          message: `managed user table ${t} contains rows after loading the declarative files`,
        })),
      );
    }
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
  return {
    factBase: result.factBase,
    pgVersion: result.pgVersion,
    diagnostics: [...result.diagnostics, ...seededBodyWarnings],
    rounds,
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
