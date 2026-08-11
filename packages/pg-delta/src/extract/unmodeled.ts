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
 * - `name`   : SQL expression producing a human-readable name per object
 * - `from`   : FROM/JOIN clause exposing `oid` and `name`
 * - `where`  : optional extra predicate (e.g. procedural-languages-only)
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
  from: string;
  where?: string;
  minVersion?: number;
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

const PROBES: readonly UnmodeledProbe[] = [
  {
    kind: "cast",
    classid: "pg_cast",
    oid: "c.oid",
    name: "format_type(c.castsource, NULL) || ' AS ' || format_type(c.casttarget, NULL)",
    from: "pg_cast c",
  },
  {
    kind: "operator",
    classid: "pg_operator",
    oid: "o.oid",
    name: "o.oprname",
    from: "pg_operator o",
  },
  {
    kind: "operator class",
    classid: "pg_opclass",
    oid: "opc.oid",
    name: "opc.opcname",
    from: "pg_opclass opc",
  },
  {
    kind: "operator family",
    classid: "pg_opfamily",
    oid: "opf.oid",
    name: "opf.opfname",
    from: "pg_opfamily opf",
  },
  {
    kind: "text search configuration",
    classid: "pg_ts_config",
    oid: "tc.oid",
    name: "tc.cfgname",
    from: "pg_ts_config tc",
  },
  {
    kind: "text search dictionary",
    classid: "pg_ts_dict",
    oid: "td.oid",
    name: "td.dictname",
    from: "pg_ts_dict td",
  },
  {
    kind: "text search parser",
    classid: "pg_ts_parser",
    oid: "tp.oid",
    name: "tp.prsname",
    from: "pg_ts_parser tp",
  },
  {
    kind: "text search template",
    classid: "pg_ts_template",
    oid: "tt.oid",
    name: "tt.tmplname",
    from: "pg_ts_template tt",
  },
  {
    kind: "statistics object",
    classid: "pg_statistic_ext",
    oid: "se.oid",
    name: "se.stxname",
    from: "pg_statistic_ext se",
  },
  {
    kind: "language",
    classid: "pg_language",
    oid: "l.oid",
    name: "l.lanname",
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
    name: "format_type(tr.trftype, NULL) || ' / ' || (SELECT ll.lanname FROM pg_language ll WHERE ll.oid = tr.trflang)",
    from: "pg_transform tr",
  },
  {
    kind: "parameter ACL",
    classid: "pg_parameter_acl",
    oid: "pa.oid",
    name: "pa.parname",
    from: "pg_parameter_acl pa",
    minVersion: 15,
  },
];

/**
 * One probe's SQL. Everything that decides WHICH rows count — the built-in OID
 * boundary and both provenance anti-joins — lives here, so the two callers can
 * never drift apart on what "an unmodeled user object" means; they differ only
 * in `projection`, the aggregate over the matching names.
 */
function probeSql(p: UnmodeledProbe, projection: string): string {
  const filters = [
    p.where,
    `${p.oid} >= ${FIRST_NORMAL_OID}`,
    `NOT ${isExtensionMember(p.classid, p.oid)}`,
    `NOT ${isInternalDependent(p.classid, p.oid)}`,
  ].filter(Boolean);
  return `SELECT '${p.kind}'::text AS kind,
            ${projection}
     FROM (
       SELECT ${p.name} AS nm
       FROM ${p.from}
       WHERE ${filters.join(" AND ")}
     ) s`;
}

/** The union of every probe active on `major`, under one projection. */
function probeUnionSql(major: number, projection: string): string {
  return PROBES.filter(
    (p) => p.minVersion === undefined || major >= p.minVersion,
  )
    .map((p) => probeSql(p, projection))
    .join("\nUNION ALL\n");
}

/** Diagnostic projection: a count plus at most five names for the message. */
const COUNT_AND_SAMPLES = `count(*)::int AS count,
            (array_agg(nm ORDER BY nm))[1:5] AS samples`;

/** Comparison projection: every name, because a set-diff cannot work on a
 *  sample. Deliberately a SEPARATE query from {@link COUNT_AND_SAMPLES} rather
 *  than a superset of it: the count+samples probe runs on EVERY extraction, and
 *  transferring an unbounded name list per kind there would make a schema with
 *  thousands of operators pay for data no diagnostic ever prints. */
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
    probeUnionSql(major, COUNT_AND_SAMPLES),
  );
  const diagnostics: Diagnostic[] = [];
  for (const row of rows) {
    if (row.count <= 0) continue;
    const samples = row.samples ?? [];
    const more = row.count > samples.length ? ", …" : "";
    diagnostics.push({
      code: "unmodeled_kind",
      severity: "warning",
      message:
        `${row.count} unmodeled "${row.kind}" object${row.count === 1 ? "" : "s"} ` +
        `not managed by this engine (e.g. ${samples.join(", ")}${more}) — ` +
        `v1 detects but does not model this kind; keep its DDL in _custom/ so ` +
        `re-exports preserve it and the shadow can elaborate dependents, and ` +
        `deliver it to targets via your migration channel`,
      context: { kind: row.kind, count: row.count, samples },
    });
  }
  return diagnostics;
}

/**
 * The same scan as {@link detectUnmodeledKinds}, but returning every identity
 * instead of a count and five samples — enough to COMPARE two databases.
 *
 * `major` is the server's major version, threaded by the caller exactly as the
 * diagnostic probe threads it (a probe whose catalog does not exist yet fails at
 * parse time, so version gating happens before the SQL is built).
 *
 * A NULL name is dropped rather than carried as a phantom identity: a name
 * expression can legitimately evaluate to NULL (the transform probe joins
 * `pg_language` in a subselect), and an unnameable object cannot be matched
 * against the other side anyway.
 */
export async function probeUnmodeledIdentities(
  q: UnmodeledQueryable,
  major: number,
): Promise<UnmodeledIdentities> {
  const { rows } = await q.query<IdentityRow>(probeUnionSql(major, ALL_NAMES));
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
