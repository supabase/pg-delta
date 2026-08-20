/**
 * Catalog completeness check — the v1 correctness floor (review finding 1).
 *
 * `extract()` only emits facts for the kinds it models. A user-created object
 * in a kind it does NOT model would otherwise be invisible: never a fact,
 * never a delta, never mentioned in the plan or the proof. That is a SILENT
 * miss, and a migration tool that silently drops part of your schema from its
 * view is not trustworthy. (The proof loop reads source and desired through
 * the same extractor, so a blind spot can even let a proof pass vacuously.)
 *
 * This module scans — in the SAME repeatable-read snapshot as the rest of
 * extraction — for present-but-unmodeled USER objects, returning one
 * `unmodeled_kind` warning per kind found. It is provenance-aware: built-in
 * (initdb-pinned) and extension-owned objects are the system's / an
 * extension's internals, NOT user state, so they are excluded — matching the
 * extractor's own `notExtensionMember` anti-join.
 *
 * "Detect, don't model": v1 need not MODEL these kinds (that is demand-driven,
 * post-v1 — add an extractor + rule + corpus scenario when a real schema needs
 * one). v1 must never SILENTLY miss them. Strict-coverage mode (the CLI /
 * frontend seam) escalates these warnings to a hard stop.
 *
 * The diagnostic also names the escape hatch, so the tool closes its own loop:
 * the reserved `_custom/` folder (frontends/custom-dir.ts) is where this DDL
 * lives so re-exports preserve it and the shadow can elaborate modeled
 * dependents (an index over a custom text search configuration, say). Delivery
 * to a target stays the operator's migration channel — an unmodeled object
 * produces no facts, so it can never enter a plan.
 *
 * Which makes "did they actually deliver it?" a question worth asking BEFORE the
 * plan is handed over, and the catalog can answer it: `probeUnmodeledIdentities`
 * runs the same scan for full identity lists, and `detectUnmodeledDrift` reports
 * one `unmodeled_drift` warning per kind the shadow has and the target lacks
 * (docs/architecture/custom-folder.md §7). That fires exactly when a generated
 * statement is about to depend on something no statement in the plan can create.
 */
import type { PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";

/**
 * A probe for one unmodeled catalog kind.
 * - `kind`   : human-readable label (also the `context.kind` discriminator)
 * - `classid`: the catalog's regclass, used to test pg_depend provenance
 * - `oid`    : SQL expression for the object's oid within `from`
 * - `name`   : SQL expression producing a human-readable name per object, for
 *   the human-facing diagnostic. It need not be UNIQUE — it is a sample in a
 *   warning message, not a key.
 * - `identity`: SQL expression producing a FULLY QUALIFYING identity per object,
 *   for the cross-database set-diff. Required (not defaulted to `name`) so a new
 *   probe cannot quietly ship a name that two different objects share: the drift
 *   diff compares these as strings, so anything the catalog needs to tell two
 *   objects apart — the schema, an operator's operand types, an opclass's access
 *   method — has to be in here. Kinds whose catalog has no namespace (`language`,
 *   `parameter ACL`) legitimately repeat `name`.
 * - `from`   : FROM/JOIN clause exposing `oid`, `name` and `identity`
 * - `where`  : optional extra predicate (e.g. procedural-languages-only)
 * - `clusterShared`: the catalog is CLUSTER-wide rather than database-local, so
 *   its objects must not be delivered through `_custom/` at all (raw declarative
 *   SQL runs in a shadow that may be co-located in the live cluster). Drives the
 *   remediation sentence of the `unmodeled_kind` diagnostic.
 * - `minVersion`: optional PG major version the probe's catalog first exists
 *   in (e.g. 15 for `pg_parameter_acl`). Probes below this version are
 *   dropped from the union query entirely — referencing a nonexistent
 *   catalog in `FROM` fails at parse time regardless of any `WHERE` guard,
 *   so gating must happen before the SQL is built, not inside it.
 */
interface UnmodeledProbe {
  kind: string;
  classid: string;
  oid: string;
  name: string;
  identity: string;
  from: string;
  where?: string;
  clusterShared?: boolean;
  minVersion?: number;
}

/**
 * A schema-qualified type name for the type at `oidExpr`, built from the catalog
 * rather than with `::regtype` / `format_type()`.
 *
 * Those two omit the schema for any type VISIBLE on the current `search_path`,
 * which makes them unusable as a cross-database identity: the drift diff runs on
 * a shadow pool and a target pool (`frontends/schema-plan.ts`), OUTSIDE the
 * extraction transaction that pins `search_path` to `pg_catalog`, so a target
 * whose connection carries a different search path would render the same type
 * differently and every identity in that kind would look like drift.
 */
function qualifiedType(oidExpr: string): string {
  return `(SELECT format('%s.%s', tn.nspname, t.typname)
       FROM pg_type t JOIN pg_namespace tn ON tn.oid = t.typnamespace
       WHERE t.oid = ${oidExpr})`;
}

/** The access method's name for the opclass/opfamily at `amOidExpr` — an
 *  opclass name is only unique per access method. */
function accessMethodName(amOidExpr: string): string {
  return `(SELECT am.amname FROM pg_am am WHERE am.oid = ${amOidExpr})`;
}

/**
 * PostgreSQL's FirstNormalObjectId. Every object created during initdb (a
 * system built-in) has an OID below this; the live server's OID counter starts
 * here and only ever issues OIDs >= it, so `oid >= 16384` ⟺ created after
 * initdb — a user or extension object. This is the canonical system/user
 * boundary in PG 14+, which retired the old `pg_depend` deptype='p' pin rows.
 */
const FIRST_NORMAL_OID = 16384;

/** Owned by an extension (deptype 'e' on the dependent side) — the same
 *  provenance the extractor uses to exclude extension members. */
function isExtensionMember(classid: string, oid: string): string {
  return `EXISTS (SELECT 1 FROM pg_depend de
    WHERE de.classid = '${classid}'::regclass
      AND de.objid = ${oid} AND de.deptype = 'e')`;
}

/**
 * Internally dependent on another object (deptype 'i' on the dependent side).
 * An internal dependent is owned outright by the object it depends on — it is
 * created alongside that object and dropped when that object is dropped, so
 * it can never be independently managed DDL. It is that object's internals,
 * not user state — reporting it as unmodeled would be a false positive as
 * long as the owning object itself is modeled.
 *
 * The canonical case is the range->multirange cast that `CREATE TYPE ... AS
 * RANGE` auto-creates: it is a `pg_cast` row registered with deptype 'i'
 * against the range type, and the modeled range type fact already covers its
 * lifecycle. Deliberately NOT 'a' (auto dependents) — those remain
 * independently droppable and so stay reportable.
 *
 * Mirrors the routine extractor's own `deptype = 'i'` anti-join
 * (extract/routines.ts), which excludes internally-dependent functions from
 * extraction for the same reason.
 */
function isInternalDependent(classid: string, oid: string): string {
  return `EXISTS (SELECT 1 FROM pg_depend idep
    WHERE idep.classid = '${classid}'::regclass
      AND idep.objid = ${oid} AND idep.deptype = 'i')`;
}

/** The language of a transform, as a scalar subselect (NULL-propagating, which is
 *  why both transform expressions concatenate with `||` rather than `format()` —
 *  see {@link probeUnmodeledIdentities} on dropped NULL names). */
const TRANSFORM_LANGUAGE =
  "(SELECT ll.lanname FROM pg_language ll WHERE ll.oid = tr.trflang)";

const PROBES: readonly UnmodeledProbe[] = [
  {
    kind: "cast",
    classid: "pg_cast",
    oid: "c.oid",
    name: "format_type(c.castsource, NULL) || ' AS ' || format_type(c.casttarget, NULL)",
    // a cast IS its source/target pair — but both must be schema-qualified, or
    // `mytype AS integer` collides across schemas
    identity: `format('%s AS %s', ${qualifiedType("c.castsource")}, ${qualifiedType("c.casttarget")})`,
    from: "pg_cast c",
  },
  {
    kind: "operator",
    classid: "pg_operator",
    oid: "o.oid",
    name: "o.oprname",
    // operators overload: the same name in the same schema over different
    // operands is a DIFFERENT operator. `oprleft = 0` for a prefix operator
    // (PG14 dropped postfix operators, so oprright is always set).
    identity: `format('%s.%s(%s, %s)', o.oprnamespace::regnamespace, o.oprname,
              COALESCE(${qualifiedType("NULLIF(o.oprleft, 0)")}, 'NONE'),
              COALESCE(${qualifiedType("NULLIF(o.oprright, 0)")}, 'NONE'))`,
    from: "pg_operator o",
  },
  {
    kind: "operator class",
    classid: "pg_opclass",
    oid: "opc.oid",
    name: "opc.opcname",
    // an opclass name is unique only per access method (`btree`/`hash`/…)
    identity: `format('%s.%s USING %s', opc.opcnamespace::regnamespace, opc.opcname,
              ${accessMethodName("opc.opcmethod")})`,
    from: "pg_opclass opc",
  },
  {
    kind: "operator family",
    classid: "pg_opfamily",
    oid: "opf.oid",
    name: "opf.opfname",
    identity: `format('%s.%s USING %s', opf.opfnamespace::regnamespace, opf.opfname,
              ${accessMethodName("opf.opfmethod")})`,
    from: "pg_opfamily opf",
  },
  {
    kind: "text search configuration",
    classid: "pg_ts_config",
    oid: "tc.oid",
    name: "tc.cfgname",
    identity: "format('%s.%s', tc.cfgnamespace::regnamespace, tc.cfgname)",
    from: "pg_ts_config tc",
  },
  {
    kind: "text search dictionary",
    classid: "pg_ts_dict",
    oid: "td.oid",
    name: "td.dictname",
    identity: "format('%s.%s', td.dictnamespace::regnamespace, td.dictname)",
    from: "pg_ts_dict td",
  },
  {
    kind: "text search parser",
    classid: "pg_ts_parser",
    oid: "tp.oid",
    name: "tp.prsname",
    identity: "format('%s.%s', tp.prsnamespace::regnamespace, tp.prsname)",
    from: "pg_ts_parser tp",
  },
  {
    kind: "text search template",
    classid: "pg_ts_template",
    oid: "tt.oid",
    name: "tt.tmplname",
    identity: "format('%s.%s', tt.tmplnamespace::regnamespace, tt.tmplname)",
    from: "pg_ts_template tt",
  },
  {
    kind: "statistics object",
    classid: "pg_statistic_ext",
    oid: "se.oid",
    name: "se.stxname",
    identity: "format('%s.%s', se.stxnamespace::regnamespace, se.stxname)",
    from: "pg_statistic_ext se",
  },
  {
    kind: "language",
    classid: "pg_language",
    oid: "l.oid",
    name: "l.lanname",
    // pg_language has no namespace — a language name is cluster-unique already
    identity: "l.lanname",
    from: "pg_language l",
    // procedural languages only — excludes the built-in internal/c/sql
    // languages (lanispl = false); plpgsql is extension-owned and so is
    // filtered by the extension-member check.
    where: "l.lanispl",
  },
  {
    kind: "transform",
    classid: "pg_transform",
    oid: "tr.oid",
    name: `format_type(tr.trftype, NULL) || ' / ' || ${TRANSFORM_LANGUAGE}`,
    // a transform IS its (type, language) pair; only the type needs qualifying
    identity: `${qualifiedType("tr.trftype")} || ' / ' || ${TRANSFORM_LANGUAGE}`,
    from: "pg_transform tr",
  },
  {
    kind: "parameter ACL",
    classid: "pg_parameter_acl",
    oid: "pa.oid",
    name: "pa.parname",
    // a GUC name has no namespace, and pg_parameter_acl is shared by the whole
    // cluster (which is also why `_custom/` is the wrong home for it)
    identity: "pa.parname",
    from: "pg_parameter_acl pa",
    clusterShared: true,
    minVersion: 15,
  },
];

/** Kinds whose catalog is cluster-wide, derived from `PROBES` so the diagnostic
 *  and the probe table can never disagree. */
const CLUSTER_SHARED_KINDS: ReadonlySet<string> = new Set(
  PROBES.filter((p) => p.clusterShared).map((p) => p.kind),
);

/**
 * One probe's SQL. Everything that decides WHICH rows count — the built-in OID
 * boundary and both provenance anti-joins — lives here, so the two callers can
 * never drift apart on what "an unmodeled user object" means; they differ only
 * in `nameExpr` (a readable sample vs a qualifying identity) and `projection`,
 * the aggregate over the matching rows.
 */
function probeSql(
  p: UnmodeledProbe,
  projection: string,
  nameExpr: string,
): string {
  const filters = [
    p.where,
    `${p.oid} >= ${FIRST_NORMAL_OID}`,
    `NOT ${isExtensionMember(p.classid, p.oid)}`,
    `NOT ${isInternalDependent(p.classid, p.oid)}`,
  ].filter(Boolean);
  return `SELECT '${p.kind}'::text AS kind,
            ${projection}
     FROM (
       SELECT ${nameExpr} AS nm
       FROM ${p.from}
       WHERE ${filters.join(" AND ")}
     ) s`;
}

/** The union of every probe active on `major`, under one projection. `qualified`
 *  picks the per-object expression: the readable `name` for the diagnostic, the
 *  fully qualifying `identity` for the cross-database set-diff. */
function probeUnionSql(
  major: number,
  projection: string,
  qualified: boolean,
): string {
  return PROBES.filter(
    (p) => p.minVersion === undefined || major >= p.minVersion,
  )
    .map((p) => probeSql(p, projection, qualified ? p.identity : p.name))
    .join("\nUNION ALL\n");
}

/** Diagnostic projection: a count plus at most five names for the message. */
const COUNT_AND_SAMPLES = `count(*)::int AS count,
            (array_agg(nm ORDER BY nm))[1:5] AS samples`;

/** Comparison projection: every IDENTITY, because a set-diff cannot work on a
 *  sample (nor on a name two objects can share). Deliberately a SEPARATE query
 *  from {@link COUNT_AND_SAMPLES} rather than a superset of it: the count+samples
 *  probe runs on EVERY extraction, and transferring an unbounded name list per
 *  kind there — qualified with per-row subselects, no less — would make a schema
 *  with thousands of operators pay for data no diagnostic ever prints. */
const ALL_NAMES = `array_agg(nm ORDER BY nm) AS names`;

interface ProbeRow {
  kind: string;
  count: number;
  samples: string[] | null;
}

interface IdentityRow {
  kind: string;
  names: (string | null)[] | null;
}

/**
 * The minimal read interface the identity probe needs — satisfied by both a
 * `Pool` and a `PoolClient`, so a caller holding either (the plan frontend holds
 * pools) can probe without checking out a dedicated connection.
 */
export interface UnmodeledQueryable {
  query<R>(sql: string): Promise<{ rows: R[] }>;
}

/** Unmodeled user-object identities per kind, as the probe found them: kinds
 *  with no such object are ABSENT rather than mapped to an empty list. */
export type UnmodeledIdentities = ReadonlyMap<string, readonly string[]>;

/**
 * Scan for present-but-unmodeled USER objects, returning one `unmodeled_kind`
 * warning per kind found. Runs ONE union query so it shares the caller's
 * snapshot and costs a single round-trip; the per-kind probes stay declarative
 * (add a row to `PROBES` to cover a newly relevant kind).
 *
 * `major` is the server's major version (`ExtractContext.pgMajor`) — callers
 * probe this once per extraction and thread it through rather than each
 * unmodeled/version-gated builder re-probing `server_version_num` itself.
 */
export async function detectUnmodeledKinds(
  client: PoolClient,
  major: number,
): Promise<Diagnostic[]> {
  const { rows } = await client.query<ProbeRow>(
    probeUnionSql(major, COUNT_AND_SAMPLES, false),
  );
  const diagnostics: Diagnostic[] = [];
  for (const row of rows) {
    if (row.count <= 0) continue;
    diagnostics.push(
      unmodeledKindDiagnostic(row.kind, row.count, row.samples ?? []),
    );
  }
  return diagnostics;
}

/** Shared `unmodeled_kind` shape so coverage filters can rewrite samples
 *  without re-templating the message. */
export function unmodeledKindDiagnostic(
  kind: string,
  count: number,
  samples: readonly string[],
): Diagnostic {
  const shown = samples.slice(0, 5);
  const more = count > shown.length ? ", …" : "";
  return {
    code: "unmodeled_kind",
    severity: "warning",
    message:
      `${count} unmodeled "${kind}" object${count === 1 ? "" : "s"} ` +
      `not managed by this engine (e.g. ${shown.join(", ")}${more}) — ` +
      `v1 detects but does not model this kind; ${remediationFor(kind)}`,
    context: { kind, count, samples: shown },
  };
}

/**
 * The remediation sentence of an `unmodeled_kind` warning, per kind.
 *
 * The default is the `_custom/` escape hatch, which is only sound for
 * DATABASE-LOCAL objects: `_custom/` files are loaded into the shadow, and a
 * `databaseScratch` shadow lives in the LIVE cluster (`frontends/load-sql-files.ts`
 * snapshots and restores roles and memberships around the load — nothing else).
 * So pointing a cluster-shared kind at `_custom/` is advice that mutates state
 * outside the shadow's blast radius, and the operator has no reason to suspect it.
 * Those kinds get the migration channel and nothing else.
 */
function remediationFor(kind: string): string {
  return CLUSTER_SHARED_KINDS.has(kind)
    ? `this kind lives in a catalog shared by every database in the cluster, so ` +
        `declarative files must not create it (a shadow load would mutate the real ` +
        `cluster) — deliver it to each target via your migration channel only`
    : `keep its DDL in _custom/ so re-exports preserve it and the shadow can ` +
        `elaborate dependents, and deliver it to targets via your migration channel`;
}

/**
 * The same scan as {@link detectUnmodeledKinds}, but returning every identity
 * instead of a count and five samples — enough to COMPARE two databases.
 *
 * `major` is the server's major version, threaded by the caller exactly as the
 * diagnostic probe threads it (a probe whose catalog does not exist yet fails at
 * parse time, so version gating happens before the SQL is built).
 *
 * Identities are FULLY QUALIFIED (`UnmodeledProbe.identity`), unlike the
 * diagnostic's sample names: the diff is a string comparison across two
 * databases, so a bare `cfgname` / `oprname` would make a text search
 * configuration in another schema — or an operator over other operand types —
 * compare EQUAL to a different object and mask the very drift this exists to
 * report.
 *
 * A NULL identity is dropped rather than carried as a phantom one: the expression
 * can legitimately evaluate to NULL (the transform probe joins `pg_language` in a
 * subselect), and an unnameable object cannot be matched against the other side
 * anyway.
 */
export async function probeUnmodeledIdentities(
  q: UnmodeledQueryable,
  major: number,
): Promise<UnmodeledIdentities> {
  const { rows } = await q.query<IdentityRow>(
    probeUnionSql(major, ALL_NAMES, true),
  );
  const byKind = new Map<string, string[]>();
  for (const row of rows) {
    const names = (row.names ?? []).filter((n): n is string => n !== null);
    if (names.length === 0) continue;
    byKind.set(row.kind, names);
  }
  return byKind;
}

/** How many missing identities the drift message spells out before eliding. */
const DRIFT_NAME_LIMIT = 10;

/**
 * The `unmodeled_drift` pre-flight guard for the delivery model
 * (docs/architecture/custom-folder.md §7).
 *
 * Raw SQL — `_custom/` included — executes only in the disposable shadow; the
 * target only ever receives GENERATED statements. Unmodeled kinds produce no
 * facts, so a plan can never create one. An object the shadow has and the target
 * lacks is therefore not a diff the engine will close: it is a prerequisite the
 * operator still owes their target, and any generated statement depending on it
 * (an index over a custom text search configuration, say) will FAIL there.
 *
 * Direction matters. Only shadow-present / target-missing is reported: a target
 * with EXTRA unmodeled objects is not drift for this purpose — nothing the plan
 * emits can depend on an object the desired state never mentioned, and those
 * extras already surface as the target's own `unmodeled_kind` warnings.
 *
 * Pure and catalog-sourced: it compares two probe results and parses no SQL.
 */
export function detectUnmodeledDrift(
  shadow: UnmodeledIdentities,
  target: UnmodeledIdentities,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const kinds = [...shadow.keys()].sort((a, b) => a.localeCompare(b));
  for (const kind of kinds) {
    const present = new Set(target.get(kind) ?? []);
    const missing = (shadow.get(kind) ?? []).filter((n) => !present.has(n));
    if (missing.length === 0) continue;
    const listed = missing.slice(0, DRIFT_NAME_LIMIT);
    const more =
      missing.length > listed.length ? `, … (${missing.length} total)` : "";
    diagnostics.push({
      code: "unmodeled_drift",
      severity: "warning",
      message:
        `${missing.length} unmodeled "${kind}" object${missing.length === 1 ? "" : "s"} ` +
        `exist in the desired state (shadow) but NOT on the target ` +
        `(${listed.join(", ")}${more}) — this engine models no facts for this kind, ` +
        `so no planned statement can create them, and any planned statement that ` +
        `depends on one will fail on the target. Deliver them through the same ` +
        `migration channel that delivers your _custom/ SQL, then re-plan`,
      context: { kind, count: missing.length, missing },
    });
  }
  return diagnostics;
}
