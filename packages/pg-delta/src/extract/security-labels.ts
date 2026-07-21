/** Security labels (satellite facts, like comments). */
import type { StableId } from "../core/stable-id.ts";
import {
  type ExtractContext,
  notExtensionMember,
  SYSTEM_SCHEMAS,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

/** pg_class relkinds that map to a SECURITY-LABEL-renderable, modeled stable id.
 *  Shared by the relation resolver and the unresolved-label diagnostic so the
 *  two can never drift. (Indexes/toast/composite-table relkinds are excluded:
 *  PostgreSQL rejects `SECURITY LABEL ON INDEX …` outright — verified on PG17 —
 *  so such a label can never exist in pg_seclabel.) */
const LABELED_RELKINDS: Record<string, StableId["kind"]> = {
  r: "table",
  p: "table",
  v: "view",
  m: "materializedView",
  S: "sequence",
  f: "foreignTable",
};

/** pg_class relkinds that produce COLUMN facts (relations.ts extracts columns
 *  only for these). A positive `objsubid` label on any OTHER relkind (a view,
 *  matview, sequence, …) has no column fact to parent on, so it must NOT become a
 *  fact — it is surfaced as an unresolved-label diagnostic instead. */
const COLUMN_BEARING_RELKINDS = new Set(["r", "p", "f"]);

/** classoids whose pg_seclabel rows the resolver turns into facts UNCONDITIONALLY.
 *  The unresolved-label diagnostic flags any local label OUTSIDE this set (e.g. a
 *  label on a LANGUAGE, LARGE OBJECT, or a pg_class relkind we don't model).
 *  `pg_type` is DELIBERATELY absent: only the modeled type KINDS resolve (see
 *  {@link modeledTypeKindSql}), so it is special-cased in both the resolver and
 *  the diagnostic rather than blanket-resolved. */
const RESOLVED_LOCAL_CLASSOIDS = [
  "pg_proc",
  "pg_namespace",
  "pg_event_trigger",
  "pg_publication",
  "pg_subscription",
] as const;

/** pg_type kinds `extractTypes` (src/extract/types.ts) actually models: domains
 *  ('d'), enums ('e'), ranges ('r'), and STANDALONE composites — a composite
 *  whose backing pg_class relkind is 'c'. A table's row type is also typtype='c'
 *  but its pg_class relkind is 'r'/'p', and a base/shell/pseudo type is some
 *  OTHER typtype; none of those get a `type` fact. A SECURITY LABEL on such an
 *  unmodeled pg_type row therefore has no parent fact to attach to — pushing it
 *  anyway made buildFactBase throw missing-parent and crash extraction. The
 *  predicate (bound to a pg_type alias) is shared by the resolver query and the
 *  unresolved-label diagnostic so the two can never drift. */
function modeledTypeKindSql(alias: string): string {
  return `(${alias}.typtype IN ('d', 'e', 'r')
    OR (${alias}.typtype = 'c' AND EXISTS (
      SELECT 1 FROM pg_class tc WHERE tc.oid = ${alias}.typrelid AND tc.relkind = 'c')))`;
}

export async function extractSecurityLabels(
  ctx: ExtractContext,
): Promise<void> {
  const { q, pushSeclabel, diagnostics } = ctx;
  // ── security labels (satellite facts, like comments) ────────────────
  // pg_seclabel / pg_shseclabel are EMPTY unless a label provider module
  // labeled something — and every row is therefore USER-applied state (there
  // are no built-in labels). One cheap existence probe gates the resolver
  // queries so a label-free database (the overwhelming common case) pays
  // a single round trip. The target's identity parts come back as a resolved
  // StableId built inline; any label whose target the resolver cannot map to a
  // supported modeled stable id is surfaced as a diagnostic (never dropped).
  const hasSeclabels = Boolean(
    (
      await q(
        `SELECT EXISTS (SELECT 1 FROM pg_seclabel)
              OR EXISTS (SELECT 1 FROM pg_shseclabel) AS present`,
      )
    )[0]?.["present"],
  );
  if (!hasSeclabels) return;

  // relations (tables/views/matviews/sequences/foreign tables) + columns
  for (const row of await q(`
      SELECT sl.provider, sl.label, sl.objsubid,
             n.nspname AS schema, c.relname AS name, c.relkind AS relkind,
             a.attname AS column
      FROM pg_seclabel sl
      JOIN pg_class c ON c.oid = sl.objoid AND sl.classoid = 'pg_class'::regclass
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = sl.objsubid
      WHERE ${USER_SCHEMA_FILTER}
      ORDER BY 1, 4, 5`)) {
    const schema = String(row["schema"]);
    const relkind = String(row["relkind"]);
    if (Number(row["objsubid"]) > 0) {
      // A column label only resolves when the relation actually produces column
      // facts (tables / partitioned tables / foreign tables). A label on a VIEW
      // or matview column has no column fact to parent on; pushing it anyway made
      // buildFactBase throw missing-parent and crash extraction. Skip it here —
      // the unresolved-label diagnostic pass below reports it (strict mode blocks,
      // default mode warns). The metadata-fidelity gap stays tracked in #332.
      if (COLUMN_BEARING_RELKINDS.has(relkind)) {
        pushSeclabel(
          {
            kind: "column",
            schema,
            table: String(row["name"]),
            name: String(row["column"]),
          },
          String(row["provider"]),
          String(row["label"]),
        );
      }
      continue;
    }
    const kind = LABELED_RELKINDS[relkind];
    if (kind === undefined) continue; // unresolved-relkind label → diagnosed below
    pushSeclabel(
      { kind, schema, name: String(row["name"]) } as StableId,
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // routines (functions / procedures / aggregates)
  for (const row of await q(`
      SELECT sl.provider, sl.label, n.nspname AS schema, p.proname AS name,
             p.prokind AS prokind,
             ARRAY(SELECT format_type(t.t, NULL)
                   FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                   ORDER BY t.ord)::text[] AS args
      FROM pg_seclabel sl
      JOIN pg_proc p ON p.oid = sl.objoid AND sl.classoid = 'pg_proc'::regclass
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${USER_SCHEMA_FILTER}
      ORDER BY 1, 3, 4`)) {
    const prokind = String(row["prokind"]);
    pushSeclabel(
      {
        kind:
          prokind === "a"
            ? "aggregate"
            : prokind === "p"
              ? "procedure"
              : "function",
        schema: String(row["schema"]),
        name: String(row["name"]),
        args: (row["args"] as string[]).map(String),
      },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // schemas
  for (const row of await q(`
      SELECT sl.provider, sl.label, n.nspname AS name
      FROM pg_seclabel sl
      JOIN pg_namespace n ON n.oid = sl.objoid AND sl.classoid = 'pg_namespace'::regclass
      WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS} AND n.nspname NOT LIKE 'pg\\_%'
      ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "schema", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // types / domains
  for (const row of await q(`
      SELECT sl.provider, sl.label, n.nspname AS schema, t.typname AS name,
             t.typtype AS typtype
      FROM pg_seclabel sl
      JOIN pg_type t ON t.oid = sl.objoid AND sl.classoid = 'pg_type'::regclass
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE ${USER_SCHEMA_FILTER} AND ${modeledTypeKindSql("t")}
      ORDER BY 1, 3, 4`)) {
    pushSeclabel(
      {
        kind: String(row["typtype"]) === "d" ? "domain" : "type",
        schema: String(row["schema"]),
        name: String(row["name"]),
      },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // event triggers (scoped like the event-trigger extractor: not extension-owned)
  for (const row of await q(`
      SELECT sl.provider, sl.label, e.evtname AS name
      FROM pg_seclabel sl
      JOIN pg_event_trigger e ON e.oid = sl.objoid AND sl.classoid = 'pg_event_trigger'::regclass
      WHERE ${notExtensionMember("pg_event_trigger", "e.oid")}
      ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "eventTrigger", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // publications
  for (const row of await q(`
      SELECT sl.provider, sl.label, p.pubname AS name
      FROM pg_seclabel sl
      JOIN pg_publication p ON p.oid = sl.objoid AND sl.classoid = 'pg_publication'::regclass
      WHERE ${notExtensionMember("pg_publication", "p.oid")}
      ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "publication", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // subscriptions (per-database catalog; superuser-visible)
  for (const row of await q(`
      SELECT sl.provider, sl.label, s.subname AS name
      FROM pg_seclabel sl
      JOIN pg_subscription s ON s.oid = sl.objoid AND sl.classoid = 'pg_subscription'::regclass
      ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "subscription", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // roles (shared catalog). `pg_roles` (not `pg_authid`) so a non-superuser
  // caller can read it — `pg_authid` itself is superuser-only and would throw
  // `permission denied for table pg_authid`; `pg_roles` exposes the same oid
  // + rolname surface this query needs (classoid stays `pg_authid`::regclass —
  // that is the underlying catalog `pg_seclabel`/`pg_shseclabel` rows key on).
  for (const row of await q(`
      SELECT sl.provider, sl.label, r.rolname AS name
      FROM pg_shseclabel sl
      JOIN pg_roles r ON r.oid = sl.objoid AND sl.classoid = 'pg_authid'::regclass
      WHERE r.rolname NOT LIKE 'pg\\_%'
      ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "role", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }

  // ── unresolved-label diagnostic (stage-2 doctrine: detect, never silently
  // drop). Every pg_seclabel/pg_shseclabel row the resolver above did NOT turn
  // into a fact is a user-applied label on a target the engine cannot manage
  // (a LANGUAGE, LARGE OBJECT, DATABASE, TABLESPACE, an unmodeled pg_class
  // relkind, …). Without this, source and desired could both omit such a label
  // and the proof would pass vacuously (review P1).
  const classoidList = RESOLVED_LOCAL_CLASSOIDS.map(
    (c) => `'${c}'::regclass`,
  ).join(", ");
  const relkindList = Object.keys(LABELED_RELKINDS)
    .map((k) => `'${k}'`)
    .join(", ");
  const columnRelkindList = [...COLUMN_BEARING_RELKINDS]
    .map((k) => `'${k}'`)
    .join(", ");
  for (const row of await q(`
      SELECT obj_class,
             count(*)::int AS count,
             (array_agg(descr ORDER BY descr))[1:5] AS samples
      FROM (
        SELECT sl.classoid::regclass::text AS obj_class,
               sl.classoid::regclass::text || ' #' || sl.objoid::text AS descr
        FROM pg_seclabel sl
        WHERE NOT (
          (sl.classoid = 'pg_class'::regclass AND EXISTS (
             SELECT 1 FROM pg_class c WHERE c.oid = sl.objoid AND (
               -- a column label resolves only on a column-bearing relkind; a
               -- view/matview column label is unresolved (no column fact)
               (sl.objsubid > 0 AND c.relkind IN (${columnRelkindList}))
               OR (sl.objsubid = 0 AND c.relkind IN (${relkindList})))))
          -- a pg_type label resolves only for a MODELED type kind; a label on a
          -- base/shell/table-rowtype pg_type is unresolved (no type fact)
          OR (sl.classoid = 'pg_type'::regclass AND EXISTS (
             SELECT 1 FROM pg_type t WHERE t.oid = sl.objoid AND ${modeledTypeKindSql("t")}))
          OR sl.classoid IN (${classoidList})
        )
        UNION ALL
        SELECT sl.classoid::regclass::text,
               sl.classoid::regclass::text || ' #' || sl.objoid::text
        FROM pg_shseclabel sl
        WHERE sl.classoid <> 'pg_authid'::regclass
      ) u
      GROUP BY obj_class
      ORDER BY obj_class`)) {
    const count = Number(row["count"]);
    const objClass = String(row["obj_class"]);
    const samples = (row["samples"] as string[] | null) ?? [];
    const more = count > samples.length ? ", …" : "";
    diagnostics.push({
      code: "unresolved_security_label",
      severity: "warning",
      message:
        `${count} security label${count === 1 ? "" : "s"} on unmodeled ` +
        `target${count === 1 ? "" : "s"} (${objClass}) cannot be managed by this engine ` +
        `(e.g. ${samples.join(", ")}${more}) — the label is reported, not applied`,
      context: { objClass, count, samples },
    });
  }
}
