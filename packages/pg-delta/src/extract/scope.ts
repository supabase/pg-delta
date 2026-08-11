/**
 * Shared extraction scope (stage 2): the constants, SQL fragments, satellite
 * pruning, and the per-extraction mutable context that the per-family query
 * builders compose. Splitting the family builders into their own modules keeps
 * each catalog family local; this module is the one place the shared pieces
 * live (target-architecture §3.1–3.2).
 * ACL identity/equality invariants: docs/architecture/identity-and-acl.md.
 */
import type { PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { DependencyEdge, Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";

/** Postgres SQLSTATE for a statement cancelled by `statement_timeout`. */
const QUERY_CANCELED = "57014";

/**
 * Whether a role name is a built-in (reserved) Postgres role. These `pg_`-prefixed
 * roles (`pg_database_owner`, `pg_read_all_data`, …) are never extracted as
 * managed facts — role extraction filters them out with `rolname NOT LIKE 'pg\_%'`
 * (see extractRolesAndGrants in ./roles.ts). This predicate is the TS mirror of
 * that SQL filter, used to suppress owner edges pointing at a built-in role: such
 * an edge would always be dangling (its target role fact is never emitted) and is
 * pruned by buildFactBase anyway, so emitting it only produces spurious
 * `dangling_edge` warnings.
 */
function isBuiltinRoleName(name: string): boolean {
  return name.startsWith("pg_");
}

/**
 * A short, human-readable identifier for an extraction query: its first FROM
 * relation plus a head of the text. Used to name the query that blew the
 * statement-timeout budget so the failure is actionable, not opaque.
 */
function queryLabel(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  const head = flat.slice(0, 60);
  return from ? `${from[1]} (${head}…)` : head;
}

/**
 * Thrown when an extraction query exceeds the caller-supplied
 * `statementTimeoutMs` budget. Turns a runaway catalog query on a pathological
 * schema into actionable output — it names the offending query and the budget —
 * instead of an opaque `canceling statement due to statement timeout` or an
 * indefinite hang (milestone A — performance).
 */
export class ExtractionTimeoutError extends Error {
  readonly code = "extraction_timeout";
  readonly queryLabel: string;
  readonly timeoutMs: number;
  readonly diagnostic: Diagnostic;
  constructor(label: string, timeoutMs: number) {
    super(
      `extraction query ${label} exceeded the ${timeoutMs}ms statement_timeout budget`,
    );
    this.name = "ExtractionTimeoutError";
    this.queryLabel = label;
    this.timeoutMs = timeoutMs;
    this.diagnostic = {
      code: this.code,
      severity: "error",
      message: this.message,
      context: { queryLabel: label, timeoutMs },
    };
  }
}

/**
 * Consistency invariant (hardening Item 4a; review #1): a metadata satellite
 * (comment / acl / securityLabel) must never outlive its target. Most are
 * pushed via `pushWithMeta` alongside their object, so a filtered object never
 * emits them — but standalone satellite extraction (security labels) can emit
 * one whose target was filtered (e.g. an extension-member object). Such a
 * satellite would make `buildFactBase` throw on a missing parent, or — if it
 * survived — yield an orphan GRANT/COMMENT at plan time (CLI-1471). Drop them
 * here with an `info` diagnostic so the exclusion is visible, never silent.
 */
export function pruneOrphanedSatellites(facts: Fact[]): {
  facts: Fact[];
  diagnostics: Diagnostic[];
} {
  const present = new Set(facts.map((f) => encodeId(f.id)));
  const kept: Fact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const fact of facts) {
    if ("target" in fact.id) {
      const targetKey = encodeId(fact.id.target);
      if (!present.has(targetKey)) {
        diagnostics.push({
          code: "orphaned_satellite",
          severity: "info",
          subject: fact.id,
          message: `dropped ${fact.id.kind} whose target ${targetKey} was not extracted (filtered)`,
        });
        continue;
      }
    }
    kept.push(fact);
  }
  return { facts: kept, diagnostics };
}

/** Schemas never treated as user state. */
export const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`;
export const USER_SCHEMA_FILTER = `
  n.nspname NOT IN ${SYSTEM_SCHEMAS}
  AND n.nspname NOT LIKE 'pg\\_toast%'
  AND n.nspname NOT LIKE 'pg\\_temp%'`;

/** Anti-join fragment: exclude objects owned by extensions, for the sub-entity
 *  and rare member-root families that are NOT yet flipped to `memberOfExtension`
 *  provenance edges (the flipped families use memberExtensionExpr/pushMemberEdge
 *  instead; see COVERAGE.md "extension member handling" + tier-4-deferrals.md). */
export function notExtensionMember(classid: string, oidExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM pg_depend ext_d
    WHERE ext_d.classid = '${classid}'::regclass
      AND ext_d.objid = ${oidExpr}
      AND ext_d.deptype = 'e')`;
}

export interface Row {
  [key: string]: unknown;
}

/** Provenance flip (4b): a scalar subquery selecting the name of the
 *  extension that OWNS this object (pg_depend deptype 'e'), or NULL. plpgsql
 *  is excluded to match the extensions extractor, which omits it — an edge to
 *  it would dangle. A flipped family SELECTs this AS ext_member_of and the
 *  loop calls pushMemberEdge so the member is observed AND tagged, instead of
 *  anti-joined away with notExtensionMember. */
export const memberExtensionExpr = (classid: string, oidExpr: string): string =>
  `(
    SELECT ext.extname
    FROM pg_depend ext_d
    JOIN pg_extension ext ON ext.oid = ext_d.refobjid
    WHERE ext_d.classid = '${classid}'::regclass
      AND ext_d.objid = ${oidExpr}
      AND ext_d.refclassid = 'pg_extension'::regclass
      AND ext_d.deptype = 'e'
      AND ext.extname <> 'plpgsql'
    LIMIT 1)`;

/** ACL subquery: aggregated per grantee, sorted, PUBLIC for grantee 0.
 *  A NULL acl column means "the built-in default" — coalescing through
 *  acldefault() (pg_dump's model) makes NULL and an explicitly
 *  instantiated default extract identically, so a REVOKE that merely
 *  materializes the owner's implicit grant is not a diff.
 *
 *  Revoked PUBLIC default: PostgreSQL grants the built-in default (USAGE on
 *  types/languages, EXECUTE on functions) to PUBLIC automatically on CREATE.
 *  When the acl is customized (non-NULL) and that PUBLIC default has been taken
 *  away (no PUBLIC row), we still emit an empty PUBLIC entry so the diff plans a
 *  `REVOKE ALL … FROM PUBLIC` that clears the create-time default. Without it a
 *  freshly created object would keep the default and never converge. The
 *  "kind has a PUBLIC default" test is derived from acldefault() itself, so it
 *  stays correct across object kinds and PG versions. */
export const aclJson = (
  aclColumn: string,
  objtype: string,
  ownerColumn: string,
) => `
    (SELECT json_agg(json_build_object(
        'grantee', acl.grantee_name,
        'privileges', acl.privileges,
        'grantable', acl.grantable,
        -- The owner's create-time default privilege set for this object kind
        -- (carried ONLY on the owner's row). Lets the planner's default-ACL
        -- elision tell "owner kept the full default" (elidable) apart from
        -- "owner revoked one of their defaults" (must keep the REVOKE/GRANT),
        -- without hardcoding the version-dependent set (PG17 added MAINTAIN).
        'ownerDefault', CASE
          WHEN acl.grantee_name = (
            SELECT rolname FROM pg_roles WHERE oid = ${ownerColumn})
          THEN (SELECT array_agg(d.privilege_type ORDER BY d.privilege_type)
                FROM aclexplode(acldefault('${objtype}', ${ownerColumn})) d
                WHERE d.grantee = ${ownerColumn})
          ELSE NULL END) ORDER BY acl.grantee_name)
     FROM (
       SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
              -- DISTINCT: aclexplode() yields one row per GRANTOR, so a privilege
              -- granted to one grantee by two grantors appears twice. pg-delta
              -- models the EFFECTIVE privilege set, not who granted it, so grantor
              -- identity is intentionally ignored — de-duplicate to avoid rendering
              -- a doubled privilege list (GRANT SELECT, SELECT ...), which
              -- Postgres collapses on apply so a re-extract no longer matches and
              -- the proof drifts.
              array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type) AS privileges,
              array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type)
                FILTER (WHERE e.is_grantable) AS grantable
       FROM aclexplode(COALESCE(${aclColumn}, acldefault('${objtype}', ${ownerColumn}))) e
       LEFT JOIN pg_roles g ON g.oid = e.grantee
       GROUP BY 1
       UNION ALL
       SELECT 'PUBLIC', ARRAY[]::text[], NULL::text[]
       WHERE ${aclColumn} IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM aclexplode(acldefault('${objtype}', ${ownerColumn})) d
           WHERE d.grantee = 0)
         AND NOT EXISTS (
           SELECT 1 FROM aclexplode(${aclColumn}) a WHERE a.grantee = 0)
       UNION ALL
       -- Revoked OWNER default (mirror of the PUBLIC case): PostgreSQL grants the
       -- owner its full default on CREATE, so a full owner revoke
       -- (REVOKE ALL ON ... FROM owner) leaves a non-NULL acl with NO owner row.
       -- Emit an empty owner entry so the diff plans a REVOKE ALL FROM owner that
       -- clears the create-time default; without it a freshly created object keeps
       -- PostgreSQL built-in owner privileges and never converges.
       SELECT (SELECT rolname FROM pg_roles WHERE oid = ${ownerColumn}),
              ARRAY[]::text[], NULL::text[]
       WHERE ${aclColumn} IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM aclexplode(acldefault('${objtype}', ${ownerColumn})) d
           WHERE d.grantee = ${ownerColumn})
         AND NOT EXISTS (
           SELECT 1 FROM aclexplode(${aclColumn}) a
           WHERE a.grantee = ${ownerColumn})
     ) acl)`;

/**
 * ACL delta for an EXTENSION MEMBER, pg_dump's `pg_init_privs` model: emit only
 * the grantees whose CURRENT privilege/grant-option set differs from the object's
 * as-installed set (`pg_init_privs.initprivs`, or `acldefault` when the extension
 * recorded no init row — a default-acl member). CREATE EXTENSION re-establishes
 * the init state, so a member that was never customized yields NO acl facts (no
 * churn on plain extensions); a customization layered afterward surfaces as its
 * delta grantees. Three shapes, via a FULL OUTER JOIN of current vs init:
 *   - added / upgraded grantee (in cur, differs from ini) → current privileges,
 *     `_initPrivs` = the install entry (null if the grantee had none at install);
 *   - fully-REVOKED init grantee (in ini, absent from cur, e.g. Supabase's
 *     `REVOKE EXECUTE … FROM PUBLIC` hardening) → an empty-privileges marker so
 *     the create renders a lone `REVOKE ALL` (grantActions);
 *   - grant-option-only change (same privileges, different grantable) → included.
 *
 * Same JSON shape as `aclJson` (+ non-semantic `_initPrivs`) so `parseAcl` reads
 * both. It omits `_ownerDefault` — a member delta carries only non-default
 * entries, so there is nothing for default-ACL elision to reconcile. `_initPrivs`
 * lets the DROP path RESTORE the install state instead of a blind `REVOKE ALL`
 * (see the `acl` rule in plan/rules/metadata.ts).
 */
export const memberAclDeltaJson = (
  aclColumn: string,
  objtype: string,
  ownerColumn: string,
  classoid: string,
  oidExpr: string,
) => `
    (SELECT json_agg(json_build_object(
        'grantee', d.grantee, 'privileges', d.privileges,
        'grantable', d.grantable, '_initPrivs', d.init_privs
      ) ORDER BY d.grantee)
     FROM (
       WITH cur AS (
         SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee,
                -- DISTINCT across grantors (aclexplode emits one row per grantor);
                -- grantor identity is intentionally ignored — see aclJson.
                array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type) AS privileges,
                COALESCE(array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type)
                  FILTER (WHERE e.is_grantable), ARRAY[]::text[]) AS grantable
         FROM aclexplode(COALESCE(${aclColumn}, acldefault('${objtype}', ${ownerColumn}))) e
         LEFT JOIN pg_roles g ON g.oid = e.grantee
         GROUP BY 1
       ),
       ini AS (
         SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee,
                -- DISTINCT across grantors (aclexplode emits one row per grantor);
                -- grantor identity is intentionally ignored — see aclJson.
                array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type) AS privileges,
                COALESCE(array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type)
                  FILTER (WHERE e.is_grantable), ARRAY[]::text[]) AS grantable
         FROM aclexplode(COALESCE(
                (SELECT ip.initprivs FROM pg_init_privs ip
                 WHERE ip.objoid = ${oidExpr}
                   AND ip.classoid = '${classoid}'::regclass
                   AND ip.objsubid = 0),
                acldefault('${objtype}', ${ownerColumn}))) e
         LEFT JOIN pg_roles g ON g.oid = e.grantee
         GROUP BY 1
       )
       SELECT
         COALESCE(cur.grantee, ini.grantee) AS grantee,
         COALESCE(cur.privileges, ARRAY[]::text[]) AS privileges,
         COALESCE(cur.grantable, ARRAY[]::text[]) AS grantable,
         CASE WHEN ini.grantee IS NOT NULL
              THEN json_build_object(
                     'privileges', ini.privileges, 'grantable', ini.grantable)
              END AS init_privs
       FROM cur FULL OUTER JOIN ini USING (grantee)
       WHERE cur.privileges IS DISTINCT FROM ini.privileges
          OR cur.grantable IS DISTINCT FROM ini.grantable
     ) d)`;

/**
 * Member-aware ACL: an extension member (pg_depend deptype 'e') uses the
 * init-privs delta (`memberAclDeltaJson`); everything else uses the full
 * `aclJson`. The member OBJECT is projected reference-only in the view (never a
 * create/drop/alter), so only these satellite customizations flow to the diff.
 */
export const aclJsonMemberAware = (
  aclColumn: string,
  objtype: string,
  ownerColumn: string,
  classoid: string,
  oidExpr: string,
) => `
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_depend md
      WHERE md.classid = '${classoid}'::regclass AND md.objid = ${oidExpr}
        AND md.refclassid = 'pg_extension'::regclass AND md.deptype = 'e')
    THEN ${memberAclDeltaJson(aclColumn, objtype, ownerColumn, classoid, oidExpr)}
    ELSE ${aclJson(aclColumn, objtype, ownerColumn)}
    END`;

/** The as-installed ACL entry for an extension member (from pg_init_privs /
 *  acldefault), carried non-semantically so the DROP path can restore it. */
export interface InitPrivs {
  privileges: string[];
  grantable: string[];
}

export const parseAcl = (
  raw: unknown,
): {
  grantee: string;
  privileges: string[];
  grantable: string[];
  ownerDefault?: string[];
  initPrivs?: InitPrivs;
}[] => {
  if (raw == null) return [];
  const entries = raw as {
    grantee: string;
    privileges: string[];
    grantable: string[] | null;
    ownerDefault: string[] | null;
    _initPrivs: { privileges: string[]; grantable: string[] | null } | null;
  }[];
  return entries.map((e) => ({
    grantee: e.grantee,
    privileges: e.privileges,
    grantable: e.grantable ?? [],
    ...(e.ownerDefault != null ? { ownerDefault: e.ownerDefault } : {}),
    ...(e._initPrivs != null
      ? {
          initPrivs: {
            privileges: e._initPrivs.privileges,
            grantable: e._initPrivs.grantable ?? [],
          },
        }
      : {}),
  }));
};

export const schemaId = (name: unknown): StableId => ({
  kind: "schema",
  name: String(name),
});

/** The per-extraction mutable context: the accumulating fact / edge /
 *  diagnostic buffers, the timeout-aware query runner, and the satellite /
 *  provenance / owner push helpers that close over the buffers. The per-family
 *  query builders receive this and push into it; the order in which the
 *  orchestrator (`extractOnClient`) calls them is what defines the resulting
 *  fact / edge ordering. */
export interface ExtractContext {
  q: (sql: string) => Promise<Row[]>;
  /** `current_setting('server_version')` — byte-identical to the pre-existing
   *  `SHOW server_version` value, probed ONCE per extraction (see
   *  createExtractContext) instead of once per family that needed it. Fed
   *  straight into `ExtractResult.pgVersion`. */
  serverVersion: string;
  /** `current_setting('server_version_num')::int`, probed once alongside
   *  `serverVersion` in the same round trip. Per-family builders that used to
   *  each re-probe this (publications.ts, types.ts, unmodeled.ts) should read
   *  this (or `pgMajor`) instead. */
  serverVersionNum: number;
  /** `Math.floor(serverVersionNum / 10000)` — the major-version gate every
   *  probing call site already computed inline from its own query. */
  pgMajor: number;
  facts: Fact[];
  edges: DependencyEdge[];
  diagnostics: Diagnostic[];
  /** Diagnostics that must ALSO ride on the resulting `FactBase` (not just
   *  `ExtractResult.diagnostics`), because `plan()` reads `FactBase.diagnostics`
   *  to gate against a delta it cannot trust (mirrors how extension-handler
   *  diagnostics are threaded — see extract.ts). Push here instead of
   *  `diagnostics` when a downstream `plan()` gate needs to see it; the
   *  orchestrator copies this onto `factBase.diagnostics` right after
   *  construction, which the final step then folds into `diagnostics` too, so
   *  every consumer still sees it exactly once. */
  factDiagnostics: Diagnostic[];
  /** When false, sensitive option values and subscription conninfo are kept in
   *  cleartext in the fact base (and therefore in every downstream channel).
   *  Default true; see sensitive-options.ts and extract.ts. */
  redactSecrets: boolean;
  pushWithMeta: (
    fact: Fact,
    row: Row,
    aclTargets?: {
      privileges: string[];
      grantable: string[];
      grantee: string;
      ownerDefault?: string[];
      initPrivs?: InitPrivs;
    }[],
  ) => void;
  pushMemberEdge: (id: StableId, row: Row) => void;
  pushOwnerEdge: (id: StableId, owner: unknown) => void;
  pushSeclabel: (target: StableId, provider: string, label: string) => void;
}

/**
 * An accumulator context with the query runner REMOVED — what a family's
 * row-processing half gets.
 *
 * A batched family's rows are fetched by the scheduler (one multi-statement
 * round trip shared with other families), so `apply` has nothing left to ask
 * the server: a query issued from there would smuggle back exactly the
 * per-family round trip the split exists to remove, and it would do so
 * invisibly. Dropping `q` from the type makes that a compile error instead of a
 * silent performance regression.
 */
export type CollectContext = Omit<ExtractContext, "q">;

/**
 * A catalog family split into its SQL half and its row-processing half, so the
 * scheduler decides WHERE the statements are sent — its own round trip, or
 * batched with other families' into one — without the family knowing.
 *
 * Contract:
 *  - `statements` is a pure function of the server version: no round trip, no
 *    catalog read, no ordering dependency on any other family. The version is
 *    already known when extraction starts (see openExtractionSession), so a
 *    version-templated family is still fully batchable.
 *  - `apply` consumes exactly ONE `Row[]` per statement, in statement order,
 *    and pushes into `ctx` in the same order the pre-split family did — that
 *    ordering is the whole equivalence argument (see ./extract.ts).
 */
export interface CatalogFamily {
  /** Short label, used in the batch's timeout label and the grouping table. */
  readonly name: string;
  readonly statements: (version: ServerVersionInfo) => readonly string[];
  readonly apply: (ctx: CollectContext, rowSets: readonly Row[][]) => void;
}

/** The timeout-aware query runner bound to one connection. Extracted so a
 *  worker connection in the bounded-parallel path (see ./parallel.ts) gets the
 *  IDENTICAL 57014 → ExtractionTimeoutError mapping the coordinator has. */
export type QueryRunner = (sql: string) => Promise<Row[]>;

export function makeQueryRunner(
  client: PoolClient,
  statementTimeoutMs?: number,
): QueryRunner {
  return async (sql: string): Promise<Row[]> => {
    try {
      return (await client.query(sql)).rows as Row[];
    } catch (error) {
      if (
        statementTimeoutMs !== undefined &&
        (error as { code?: string }).code === QUERY_CANCELED
      ) {
        throw new ExtractionTimeoutError(queryLabel(sql), statementTimeoutMs);
      }
      throw error;
    }
  };
}

/**
 * Runs a BATCH of parameterless setup statements in ONE round trip.
 *
 * node-pg sends a multi-statement string over the simple query protocol and hands
 * back an ARRAY of results, one per statement in statement order — which is what
 * lets the whole session preamble (and the version probe inside it) cost a single
 * network round trip instead of one per statement. On a remote database that is
 * the difference between ~5 RTT and ~1 RTT before any catalog work starts.
 *
 * Two properties every batch here must preserve:
 *  - **No bind parameters.** The simple protocol cannot carry them.
 *  - **No statement that can error.** PostgreSQL stops executing a multi-statement
 *    string at the first failure and the whole transaction is left aborted, so a
 *    fallible statement in a batch takes the entire session down with it.
 */
export type BatchRunner = (
  statements: readonly string[],
  label: string,
) => Promise<Row[][]>;

export function makeBatchRunner(
  client: PoolClient,
  statementTimeoutMs?: number,
): BatchRunner {
  return async (statements, label) => {
    try {
      const result = await client.query(statements.join(";\n"));
      // a single-statement string comes back as one result object, not an array
      const results = (Array.isArray(result) ? result : [result]) as {
        rows: Row[];
      }[];
      return results.map((one) => one.rows);
    } catch (error) {
      if (
        statementTimeoutMs !== undefined &&
        (error as { code?: string }).code === QUERY_CANCELED
      ) {
        throw new ExtractionTimeoutError(label, statementTimeoutMs);
      }
      throw error;
    }
  };
}

/** The version metadata every extraction needs, probed ONCE per extraction —
 *  including the parallel path, where the coordinator's probe is handed to every
 *  worker context instead of each re-probing (see ./parallel.ts). */
export interface ServerVersionInfo {
  serverVersion: string;
  serverVersionNum: number;
  pgMajor: number;
}

const BEGIN_STATEMENT = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";

// Canonicalize the deparse path (pg_dump convention, post-CVE-2018-1058):
// `format_type` and every `pg_get_*def` / `pg_get_expr` path-relativizes names, so
// anything visible on the session `search_path` comes back UNQUALIFIED. Pinning to
// `pg_catalog` forces every non-catalog reference to be schema-qualified, so the
// SAME catalog hashes identically regardless of the database's / role's /
// connection's default path. SET LOCAL scopes it to this transaction and is
// discarded on COMMIT/ROLLBACK, so pooled connections are untouched.
const SEARCH_PATH_STATEMENT = "SET LOCAL search_path TO 'pg_catalog'";

const VERSION_PROBE_STATEMENT = `SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS num`;

/** Opt-in per-statement budget: a runaway catalog query on a pathological schema
 *  aborts with an actionable ExtractionTimeoutError (see makeQueryRunner) instead
 *  of hanging. Default is unlimited — never abort a legitimate large extraction
 *  unless the caller asked for a budget. */
function statementTimeoutStatement(statementTimeoutMs: number): string {
  return `SET LOCAL statement_timeout = ${Math.max(0, Math.floor(statementTimeoutMs))}`;
}

/** Stable label for the setup batch, so a `statement_timeout` that fires during
 *  setup still names what was running (see makeBatchRunner / ExtractionTimeoutError). */
const SETUP_BATCH_LABEL = "session setup";

export interface OpenedSession {
  version: ServerVersionInfo;
  /** Present only when `exportSnapshot` was requested AND succeeded. */
  snapshotId?: string;
}

/**
 * Open the extraction transaction and learn the server version in ONE round trip:
 * BEGIN + search_path + optional statement budget + version probe, and — for the
 * bounded-parallel path — `pg_export_snapshot()` in the same batch, so worker
 * connections can start importing the snapshot after a single RTT.
 *
 * Deliberately NOT in this batch: the JIT-off statement. Its form depends on the
 * major version THIS batch discovers, and the >= 15 form calls
 * `has_parameter_privilege()`, which does not exist on 14 — so it cannot be
 * included speculatively without risking exactly the mid-batch error that would
 * abort the transaction. It is a second round trip (see jitOffSql), which the
 * parallel path overlaps with worker setup so it costs one RTT, not one per
 * connection.
 *
 * Throws if any statement fails — including `pg_export_snapshot()` on a standby or
 * behind a restrictive pooler, which leaves the transaction aborted. The caller
 * recovers by rolling back and re-opening WITHOUT the export.
 */
export async function openExtractionSession(
  batch: BatchRunner,
  statementTimeoutMs: number | undefined,
  exportSnapshot: boolean,
): Promise<OpenedSession> {
  const statements = [BEGIN_STATEMENT, SEARCH_PATH_STATEMENT];
  if (statementTimeoutMs !== undefined) {
    statements.push(statementTimeoutStatement(statementTimeoutMs));
  }
  const probeIndex = statements.push(VERSION_PROBE_STATEMENT) - 1;
  const snapshotIndex = exportSnapshot
    ? statements.push("SELECT pg_export_snapshot() AS id") - 1
    : -1;

  const results = await batch(statements, SETUP_BATCH_LABEL);
  const versionRow = results[probeIndex]?.[0];
  const serverVersionNum = Number(versionRow?.["num"] ?? 0);
  const version: ServerVersionInfo = {
    serverVersion: (versionRow?.["version"] as string) ?? "unknown",
    serverVersionNum,
    pgMajor: Math.floor(serverVersionNum / 10000),
  };
  if (snapshotIndex === -1) return { version };
  const id = results[snapshotIndex]?.[0]?.["id"];
  return typeof id === "string" ? { version, snapshotId: id } : { version };
}

/**
 * The worker-side equivalent, as ONE round trip: join the coordinator's exported
 * snapshot and adopt the identical session state.
 *
 * `SET TRANSACTION SNAPSHOT` must come immediately after BEGIN — PostgreSQL
 * rejects it once the transaction has run any query — and it does work inside a
 * multi-statement batch (verified against PG 17; the batch is one simple-query
 * message, so nothing runs "before" it). `pgMajor` is already known here, so
 * unlike the coordinator the worker's JIT-off rides along.
 */
export function workerSessionStatements(
  snapshotId: string,
  statementTimeoutMs: number | undefined,
  pgMajor: number,
): string[] {
  const statements = [
    BEGIN_STATEMENT,
    `SET TRANSACTION SNAPSHOT '${snapshotId}'`,
    SEARCH_PATH_STATEMENT,
  ];
  if (statementTimeoutMs !== undefined) {
    statements.push(statementTimeoutStatement(statementTimeoutMs));
  }
  statements.push(jitOffSql(pgMajor));
  return statements;
}

/**
 * Single combined round trip for both pieces of version metadata every
 * extraction needs: `server_version` (the exact string `SHOW server_version`
 * used to return, fed into ExtractResult.pgVersion) and `server_version_num`
 * (the major-version gate several per-family builders used to each re-probe
 * with their own `SELECT current_setting('server_version_num')` round trip).
 */
async function probeServerVersion(q: QueryRunner): Promise<ServerVersionInfo> {
  const versionRow = (
    await q(
      `SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS num`,
    )
  )[0];
  const serverVersionNum = Number(versionRow?.["num"] ?? 0);
  return {
    serverVersion: (versionRow?.["version"] as string) ?? "unknown",
    serverVersionNum,
    pgMajor: Math.floor(serverVersionNum / 10000),
  };
}

/**
 * The never-errors JIT-disable statement for a given server major. See the call
 * site in extract.ts for the full rationale — the short version is that a failed
 * statement poisons the WHOLE transaction, so this must be structurally
 * incapable of erroring. Shared with the parallel path so every worker
 * connection gets the same treatment as the coordinator.
 */
export function jitOffSql(pgMajor: number): string {
  return pgMajor >= 15
    ? "SELECT set_config('jit', 'off', true) WHERE has_parameter_privilege(current_user, 'jit', 'SET')"
    : "SET LOCAL jit = off";
}

/**
 * A FRESH accumulator context over an existing query runner + already-probed
 * version metadata: its own facts / edges / diagnostics buffers and its own push
 * helpers closing over them, and no round trips of its own.
 *
 * The bounded-parallel path (./parallel.ts) gives every scheduled family its own
 * collector so per-family results can be slotted by family INDEX and merged in
 * the fixed call order — completion order must never reach the output.
 */
export function createCollectorContext(
  q: QueryRunner,
  version: ServerVersionInfo,
  redactSecrets: boolean,
): ExtractContext {
  const facts: Fact[] = [];
  const edges: DependencyEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const factDiagnostics: Diagnostic[] = [];
  const { serverVersion, serverVersionNum, pgMajor } = version;

  /** Helper: push a fact plus its optional comment/acl satellite facts. */
  const pushWithMeta = (
    fact: Fact,
    row: Row,
    aclTargets?: {
      privileges: string[];
      grantable: string[];
      grantee: string;
      ownerDefault?: string[];
      initPrivs?: InitPrivs;
    }[],
  ): void => {
    facts.push(fact);
    const comment = row["comment"];
    if (typeof comment === "string") {
      // a constraint on a DOMAIN needs `COMMENT ON CONSTRAINT … ON DOMAIN …`,
      // not the table form — but commentTarget only sees the (identically
      // shaped) constraint id and `drop` has no FactView to look up the parent.
      // Carry the discriminator on the satellite payload so every comment
      // callback (create / alter / drop) renders the right target.
      const onDomain =
        fact.id.kind === "constraint" && fact.parent?.kind === "domain";
      facts.push({
        id: { kind: "comment", target: fact.id },
        parent: fact.id,
        payload: onDomain
          ? { text: comment, onDomain: true }
          : { text: comment },
      });
    }
    for (const acl of aclTargets ?? []) {
      facts.push({
        id: { kind: "acl", target: fact.id, grantee: acl.grantee },
        parent: fact.id,
        payload: {
          privileges: acl.privileges,
          grantable: acl.grantable,
          // owner-only NON-SEMANTIC metadata (`_` prefix → excluded from the
          // hash/diff, see hash.ts): the owner's create-time default privilege
          // set, consumed by the planner's default-ACL elision
          // (elideDefaultAclCreates). It is version-dependent (PG17 added
          // MAINTAIN), so it must NOT join the equality surface or it would cause
          // spurious cross-version / snapshot diff deltas and fingerprint drift.
          ...(acl.ownerDefault !== undefined
            ? { _ownerDefault: acl.ownerDefault }
            : {}),
          // as-installed ACL for an extension member (non-semantic `_` prefix):
          // lets the DROP path restore install state instead of REVOKE ALL.
          // Built as a fresh literal so it satisfies the Payload index signature.
          ...(acl.initPrivs !== undefined
            ? {
                _initPrivs: {
                  privileges: acl.initPrivs.privileges,
                  grantable: acl.initPrivs.grantable,
                },
              }
            : {}),
        },
      });
    }
  };

  /** Emit a `memberOfExtension` edge from `id` to its owning extension when the
   *  row's `ext_member_of` column (from memberExtensionExpr) is set. The edge's
   *  `from` is the exact fact id, so it can never drift from the fact. */
  const pushMemberEdge = (id: StableId, row: Row): void => {
    const ext = row["ext_member_of"];
    if (typeof ext === "string") {
      edges.push({
        from: id,
        to: { kind: "extension", name: ext },
        kind: "memberOfExtension",
      });
    }
  };

  /** Emit an `owner` edge from `id` to its owning role when the owner value is
   *  a non-empty, non-built-in role. buildFactBase prunes dangling edges silently
   *  (e.g. a system-role owner not extracted) so out-of-view owners just get no
   *  edge — but a built-in (`pg_`-prefixed) owner such as `pg_database_owner` is
   *  NEVER extracted as a role fact, so its edge is always dangling; skipping it
   *  here avoids the recurring `dangling_edge` warning without changing the fact
   *  base (the edge would be pruned regardless). */
  const pushOwnerEdge = (id: StableId, owner: unknown): void => {
    if (
      typeof owner === "string" &&
      owner.length > 0 &&
      !isBuiltinRoleName(owner)
    ) {
      edges.push({
        from: id,
        to: { kind: "role", name: owner },
        kind: "owner",
      });
    }
  };

  const pushSeclabel = (
    target: StableId,
    provider: string,
    label: string,
  ): void => {
    facts.push({
      id: { kind: "securityLabel", target, provider },
      parent: target,
      payload: { label },
    });
  };

  return {
    q,
    serverVersion,
    serverVersionNum,
    pgMajor,
    facts,
    edges,
    diagnostics,
    factDiagnostics,
    redactSecrets,
    pushWithMeta,
    pushMemberEdge,
    pushOwnerEdge,
    pushSeclabel,
  };
}

/**
 * The coordinator's context: a query runner on `client` plus the one version
 * probe the whole extraction gets. The parallel path builds its per-family
 * collectors with `createCollectorContext` and hands them THIS context's probed
 * values, so no worker ever spends a second probe round trip.
 */
export async function createExtractContext(
  client: PoolClient,
  statementTimeoutMs?: number,
  redactSecrets = true,
): Promise<ExtractContext> {
  const q = makeQueryRunner(client, statementTimeoutMs);
  return createCollectorContext(q, await probeServerVersion(q), redactSecrets);
}
