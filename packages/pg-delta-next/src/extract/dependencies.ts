/** Dependency edges: inheritance / partition edges and the authoritative
 *  pg_depend resolver (target-architecture §3.2, milestone A set-based form). */
import { encodeId, type StableId } from "../core/stable-id.ts";
import { type ExtractContext, SYSTEM_SCHEMAS } from "./scope.ts";

export async function extractInheritanceEdges(
  ctx: ExtractContext,
): Promise<void> {
  const { q, edges } = ctx;
  // ── inheritance / partition edges (child depends on parent) ──────────
  for (const row of await q(`
    SELECT cn.nspname AS child_schema, cc.relname AS child_name,
           pn.nspname AS parent_schema, pc.relname AS parent_name
    FROM pg_inherits i
    JOIN pg_class cc ON cc.oid = i.inhrelid
    JOIN pg_namespace cn ON cn.oid = cc.relnamespace
    JOIN pg_class pc ON pc.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE cc.relkind IN ('r', 'p')
      AND cn.nspname NOT IN ${SYSTEM_SCHEMAS}`)) {
    edges.push({
      from: {
        kind: "table",
        schema: String(row["child_schema"]),
        name: String(row["child_name"]),
      },
      to: {
        kind: "table",
        schema: String(row["parent_schema"]),
        name: String(row["parent_name"]),
      },
      kind: "depends",
    });
  }
}

export async function extractDependencyEdges(
  ctx: ExtractContext,
): Promise<void> {
  const { q, edges, diagnostics } = ctx;
  // ── dependency edges from pg_depend (the authoritative source, P1) ───
  // Resolve each pg_depend endpoint to a StableId, set-based. The old form ran
  // a ~160-line correlated CASE scalar subquery TWICE per pg_depend row
  // (dependent + referenced) — ~86% of total extraction time on a large catalog
  // (milestone A profile). Here, each resolver branch is a derived table built
  // ONCE over its catalog; the distinct endpoint set is hash-joined to them and
  // a classid CASE picks the right one (the classid gate on every join also
  // prevents cross-catalog OID collisions). The json_build_object shapes are
  // byte-identical to the old resolver, so toId() below is unchanged — only the
  // evaluation strategy differs (the depend-edges oracle test pins the result).
  const dependRows = await q(`
    WITH dep AS (
      SELECT d.classid, d.objid, d.objsubid,
             d.refclassid, d.refobjid, d.refobjsubid
      FROM pg_depend d
      WHERE d.deptype IN ('n', 'a')
        -- sequence OWNED BY is carried as payload + ALTER SEQUENCE … OWNED BY
        -- (pg_dump's model); the auto edge would cycle with the column default
        AND NOT (d.deptype = 'a'
                 AND d.classid = 'pg_class'::regclass
                 AND d.refclassid = 'pg_class'::regclass
                 AND d.refobjsubid > 0
                 AND EXISTS (SELECT 1 FROM pg_class sc
                             WHERE sc.oid = d.objid AND sc.relkind = 'S'))
    ),
    endpoints AS (
      SELECT classid, objid, objsubid FROM dep
      UNION
      SELECT refclassid, refobjid, refobjsubid FROM dep
    ),
    -- one derived table per resolver branch, each built once over its catalog
    rel AS (
      SELECT rc.oid, rc.relkind, json_build_object('kind',
               CASE rc.relkind
                 WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
                 WHEN 'f' THEN 'foreignTable'
                 WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView'
                 WHEN 'i' THEN 'index' WHEN 'I' THEN 'index'
                 WHEN 'S' THEN 'sequence' END,
               'schema', rn.nspname, 'name', rc.relname) AS id
      FROM pg_class rc JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      WHERE rc.relkind IN ('r','p','f','v','m','i','I','S')
    ),
    cbi AS (
      -- a constraint-backed index resolves to its constraint, not the index
      SELECT con.conindid AS oid,
             json_build_object('kind','constraint','schema',cn.nspname,
                               'table',cc.relname,'name',con.conname) AS id
      FROM pg_constraint con
      JOIN pg_class cc ON cc.oid = con.conrelid
      JOIN pg_namespace cn ON cn.oid = cc.relnamespace
      WHERE con.contype IN ('p','u','x') AND con.conindid <> 0
    ),
    col AS (
      SELECT att.attrelid AS oid, att.attnum AS subid,
             json_build_object('kind','column','schema',rn.nspname,
                               'table',rc.relname,'name',att.attname) AS id
      FROM pg_attribute att
      JOIN pg_class rc ON rc.oid = att.attrelid AND rc.relkind IN ('r','p','f')
      JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      WHERE att.attnum > 0 AND NOT att.attisdropped
    ),
    proc AS (
      SELECT pp.oid, json_build_object(
               'kind', CASE pp.prokind WHEN 'a' THEN 'aggregate' WHEN 'p' THEN 'procedure' ELSE 'function' END,
               'schema', pn.nspname, 'name', pp.proname,
               'args', ARRAY(SELECT format_type(t.t, NULL)
                             FROM unnest(pp.proargtypes) WITH ORDINALITY AS t(t, ord)
                             ORDER BY t.ord)::text[]) AS id
      FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
      WHERE pp.prokind IN ('f','p','a')
    ),
    tcon AS (
      SELECT con.oid, json_build_object('kind','constraint','schema',cn.nspname,
                               'table',cc.relname,'name',con.conname) AS id
      FROM pg_constraint con
      JOIN pg_class cc ON cc.oid = con.conrelid
      JOIN pg_namespace cn ON cn.oid = cc.relnamespace
      WHERE con.conrelid <> 0
    ),
    dcon AS (
      SELECT con.oid, json_build_object('kind','constraint','schema',dn.nspname,
                               'table',dt.typname,'name',con.conname) AS id
      FROM pg_constraint con
      JOIN pg_type dt ON dt.oid = con.contypid
      JOIN pg_namespace dn ON dn.oid = dt.typnamespace
      WHERE con.contypid <> 0
    ),
    typ AS (
      SELECT tt.oid,
        CASE
          WHEN tt.typrelid <> 0::oid AND rc.oid IS NOT NULL THEN
            json_build_object(
              'kind', CASE rc.relkind
                        WHEN 'v' THEN 'view'
                        WHEN 'm' THEN 'materializedView'
                        WHEN 'f' THEN 'foreignTable'
                        ELSE 'table'
                      END,
              'schema', rn.nspname,
              'name', rc.relname)
          ELSE json_build_object(
            'kind', CASE tt.typtype WHEN 'd' THEN 'domain' ELSE 'type' END,
            'schema', tn.nspname,
            'name', tt.typname)
        END AS id
      FROM pg_type tt
      JOIN pg_namespace tn ON tn.oid = tt.typnamespace
      LEFT JOIN pg_class rc ON rc.oid = tt.typrelid
                           AND rc.relkind IN ('r', 'p', 'f', 'v', 'm')
      LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      WHERE tt.typtype IN ('d', 'e', 'c', 'r')
    ),
    -- a composite type's pg_class (relkind c) endpoint resolves to the composite
    -- TYPE fact. pg_depend records a composite attribute's type dependency as
    -- (classid=pg_class, objid=composite pg_class, objsubid=attnum) -> pg_type,
    -- but the col CTE excludes relkind c. Attributing the edge to the top-level
    -- type (not the folded typeAttribute child) keeps the create/teardown
    -- ordering of a composite-uses-domain/type chain correct and independent of
    -- child-drop folding.
    comptype AS (
      SELECT cc.oid, json_build_object('kind','type','schema',cn.nspname,
                               'name',cc.relname) AS id
      FROM pg_class cc JOIN pg_namespace cn ON cn.oid = cc.relnamespace
      WHERE cc.relkind = 'c'
    ),
    extm AS (
      -- a reference INTO an extension-member object resolves to the extension,
      -- not the member fact (4b Stage 3): the member is observed but projected
      -- out by default, so a member-targeted edge would be pruned with it and
      -- lose the dependent's ordering on the extension. One join keyed by
      -- (classid, objid) replaces the old per-branch nested pg_depend lookups;
      -- an object belongs to at most one extension, so (classid, objid) is
      -- unique here and the join never multiplies dep rows (the old form's
      -- LIMIT 1 was guarding the same single-membership invariant).
      SELECT ed.classid, ed.objid,
             json_build_object('kind','extension','name',ext.extname) AS id
      FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
      WHERE ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
    ),
    coll AS (
      SELECT cl.oid, json_build_object('kind','collation','schema',cln.nspname,
                               'name',cl.collname) AS id
      FROM pg_collation cl JOIN pg_namespace cln ON cln.oid = cl.collnamespace
    ),
    pol AS (
      SELECT po.oid, json_build_object('kind','policy','schema',pn.nspname,
                               'table',pc.relname,'name',po.polname) AS id
      FROM pg_policy po
      JOIN pg_class pc ON pc.oid = po.polrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    ),
    evt AS (
      SELECT et.oid, json_build_object('kind','eventTrigger','name',et.evtname) AS id
      FROM pg_event_trigger et
    ),
    pub AS (
      SELECT pb.oid, json_build_object('kind','publication','name',pb.pubname) AS id
      FROM pg_publication pb
    ),
    pubrel AS (
      SELECT pr.oid, json_build_object('kind','publication','name',pb.pubname) AS id
      FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid = pr.prpubid
    ),
    fdw AS (
      SELECT fd.oid, json_build_object('kind','fdw','name',fd.fdwname) AS id
      FROM pg_foreign_data_wrapper fd
    ),
    srv AS (
      SELECT fs.oid, json_build_object('kind','server','name',fs.srvname) AS id
      FROM pg_foreign_server fs
    ),
    adef AS (
      SELECT ad.oid, json_build_object('kind','default','schema',dn.nspname,
                               'table',dc.relname,'name',da.attname) AS id
      FROM pg_attrdef ad
      JOIN pg_class dc ON dc.oid = ad.adrelid
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      JOIN pg_attribute da ON da.attrelid = ad.adrelid AND da.attnum = ad.adnum
    ),
    rw AS (
      SELECT r.oid, json_build_object(
               'kind', CASE vc.relkind WHEN 'm' THEN 'materializedView' ELSE 'view' END,
               'schema', vn.nspname, 'name', vc.relname) AS id
      FROM pg_rewrite r
      JOIN pg_class vc ON vc.oid = r.ev_class
      JOIN pg_namespace vn ON vn.oid = vc.relnamespace
      WHERE vc.relkind IN ('v','m')
    ),
    trg AS (
      SELECT tg.oid, json_build_object('kind','trigger','schema',tn.nspname,
                               'table',tc.relname,'name',tg.tgname) AS id
      FROM pg_trigger tg
      JOIN pg_class tc ON tc.oid = tg.tgrelid
      JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      WHERE NOT tg.tgisinternal
    ),
    nsp AS (
      SELECT ns.oid, json_build_object('kind','schema','name',ns.nspname) AS id
      FROM pg_namespace ns
    ),
    -- MATERIALIZED: resolved is referenced twice (rd + rr joins); force a single
    -- evaluation over the distinct endpoint set.
    resolved AS MATERIALIZED (
      SELECT e.classid, e.objid, e.objsubid,
        CASE
          WHEN e.classid = 'pg_class'::regclass AND e.objsubid = 0
            THEN COALESCE(cbi.id, comptype.id, rel.id)
          WHEN e.classid = 'pg_class'::regclass AND e.objsubid > 0
            -- a real column; a composite type's attribute resolves to its type;
            -- else a view/matview column resolves to its relation
            THEN COALESCE(col.id, comptype.id, CASE WHEN rel.relkind IN ('v','m') THEN rel.id END)
          WHEN e.classid = 'pg_proc'::regclass THEN COALESCE(extm.id, proc.id)
          WHEN e.classid = 'pg_constraint'::regclass THEN COALESCE(tcon.id, dcon.id)
          WHEN e.classid = 'pg_type'::regclass THEN COALESCE(extm.id, typ.id)
          WHEN e.classid = 'pg_opclass'::regclass THEN extm.id
          WHEN e.classid = 'pg_opfamily'::regclass THEN extm.id
          WHEN e.classid = 'pg_operator'::regclass THEN extm.id
          WHEN e.classid = 'pg_collation'::regclass THEN coll.id
          WHEN e.classid = 'pg_policy'::regclass THEN pol.id
          WHEN e.classid = 'pg_event_trigger'::regclass THEN evt.id
          WHEN e.classid = 'pg_publication'::regclass THEN pub.id
          WHEN e.classid = 'pg_publication_rel'::regclass THEN pubrel.id
          WHEN e.classid = 'pg_foreign_data_wrapper'::regclass
            THEN COALESCE(extm.id, fdw.id)
          WHEN e.classid = 'pg_foreign_server'::regclass THEN srv.id
          WHEN e.classid = 'pg_attrdef'::regclass THEN adef.id
          WHEN e.classid = 'pg_rewrite'::regclass THEN rw.id
          WHEN e.classid = 'pg_trigger'::regclass THEN trg.id
          WHEN e.classid = 'pg_namespace'::regclass THEN nsp.id
          ELSE NULL
        END AS id
      FROM endpoints e
      LEFT JOIN rel    ON rel.oid    = e.objid AND e.classid = 'pg_class'::regclass
      LEFT JOIN cbi    ON cbi.oid    = e.objid AND e.classid = 'pg_class'::regclass AND e.objsubid = 0
      LEFT JOIN col    ON col.oid    = e.objid AND col.subid = e.objsubid AND e.classid = 'pg_class'::regclass
      LEFT JOIN proc   ON proc.oid   = e.objid AND e.classid = 'pg_proc'::regclass
      LEFT JOIN tcon   ON tcon.oid   = e.objid AND e.classid = 'pg_constraint'::regclass
      LEFT JOIN dcon   ON dcon.oid   = e.objid AND e.classid = 'pg_constraint'::regclass
      LEFT JOIN typ    ON typ.oid    = e.objid AND e.classid = 'pg_type'::regclass
      LEFT JOIN comptype ON comptype.oid = e.objid AND e.classid = 'pg_class'::regclass
      LEFT JOIN extm   ON extm.classid = e.classid AND extm.objid = e.objid
      LEFT JOIN coll   ON coll.oid   = e.objid AND e.classid = 'pg_collation'::regclass
      LEFT JOIN pol    ON pol.oid    = e.objid AND e.classid = 'pg_policy'::regclass
      LEFT JOIN evt    ON evt.oid    = e.objid AND e.classid = 'pg_event_trigger'::regclass
      LEFT JOIN pub    ON pub.oid    = e.objid AND e.classid = 'pg_publication'::regclass
      LEFT JOIN pubrel ON pubrel.oid = e.objid AND e.classid = 'pg_publication_rel'::regclass
      LEFT JOIN fdw    ON fdw.oid    = e.objid AND e.classid = 'pg_foreign_data_wrapper'::regclass
      LEFT JOIN srv    ON srv.oid    = e.objid AND e.classid = 'pg_foreign_server'::regclass
      LEFT JOIN adef   ON adef.oid   = e.objid AND e.classid = 'pg_attrdef'::regclass
      LEFT JOIN rw     ON rw.oid     = e.objid AND e.classid = 'pg_rewrite'::regclass
      LEFT JOIN trg    ON trg.oid    = e.objid AND e.classid = 'pg_trigger'::regclass
      LEFT JOIN nsp    ON nsp.oid    = e.objid AND e.classid = 'pg_namespace'::regclass
    )
    SELECT rd.id AS dependent, rr.id AS referenced
    FROM dep
    JOIN resolved rd ON rd.classid = dep.classid
                    AND rd.objid = dep.objid
                    AND rd.objsubid = dep.objsubid
    JOIN resolved rr ON rr.classid = dep.refclassid
                    AND rr.objid = dep.refobjid
                    AND rr.objsubid = dep.refobjsubid`);

  const toId = (raw: unknown): StableId | undefined => {
    if (raw == null) return undefined;
    const o = raw as Record<string, string>;
    switch (o["kind"]) {
      case "schema":
        return { kind: "schema", name: o["name"] as string };
      case "eventTrigger":
      case "publication":
      case "fdw":
      case "server":
      case "extension":
        return { kind: o["kind"], name: o["name"] as string };
      case "table":
      case "view":
      case "materializedView":
      case "index":
      case "sequence":
      case "domain":
      case "type":
      case "collation":
      case "foreignTable":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          name: o["name"] as string,
        };
      case "column":
      case "constraint":
      case "default":
      case "trigger":
      case "policy":
      case "rule":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          table: o["table"] as string,
          name: o["name"] as string,
        };
      case "function":
      case "procedure":
      case "aggregate":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          name: o["name"] as string,
          args: (o["args"] as unknown as string[]).map(String),
        };
      default:
        return undefined;
    }
  };

  // A pg_depend endpoint resolves to one of three things:
  //  - null JSON      → a built-in / unmodeled object (pg_catalog type, …):
  //                     legitimately skipped, NOT a gap.
  //  - structured obj → a user object the resolver recognized; toId must
  //                     produce its id. If toId returns undefined here the
  //                     resolver and the codec disagree — a real extraction
  //                     gap, surfaced as a diagnostic (stage-2 doctrine).
  //  - resolved id whose fact is absent → a dangling edge, already turned
  //                     into a diagnostic by the FactBase constructor.
  // A user object can never live in a system schema, so any endpoint resolving
  // into one is a built-in PostgreSQL guarantees — never extracted as a fact.
  // Resolving it to "skip" (like a null endpoint) keeps the edge set identical
  // (such an edge was already dropped as dangling by the FactBase constructor)
  // while removing the flood of system `dangling_edge` diagnostics that would
  // otherwise bury real user-facing warnings (review P1).
  const isSystemScopedId = (id: StableId): boolean => {
    const sysName = (n: string): boolean =>
      n === "pg_catalog" ||
      n === "information_schema" ||
      n.startsWith("pg_toast") ||
      n.startsWith("pg_temp");
    const schema = (id as { schema?: unknown }).schema;
    if (typeof schema === "string" && sysName(schema)) return true;
    if (id.kind === "schema") return sysName((id as { name: string }).name);
    return false;
  };
  const resolveEndpoint = (
    raw: unknown,
    role: string,
  ): StableId | undefined => {
    if (raw == null) return undefined; // built-in / unmodeled — skip quietly
    const id = toId(raw);
    if (id === undefined) {
      diagnostics.push({
        code: "unresolved_dependency",
        severity: "warning",
        message: `pg_depend ${role} ${JSON.stringify(raw)} was recognized by the resolver but the codec could not build its id — resolver/codec mismatch`,
      });
      return id;
    }
    if (isSystemScopedId(id)) return undefined; // built-in catalog object — skip quietly
    return id;
  };
  const seenEdges = new Set<string>();
  for (const row of dependRows) {
    const from = resolveEndpoint(row["dependent"], "dependent");
    const to = resolveEndpoint(row["referenced"], "referenced");
    if (!from || !to) continue;
    const key = JSON.stringify([from, to]);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from, to, kind: "depends" });
    // pg_attrdef dependencies resolve to `default` facts, but a default has no
    // action producer of its own — it is folded into the column. Shadow every
    // attrdef dep onto the column so ordering works for both ordinary defaults
    // (column → sequence for nextval(...)) and generated columns (column →
    // referenced base columns/functions, which PG records as NORMAL deps of the
    // attrdef even though the generated column carries no default fact).
    if (from.kind === "default") {
      const columnFrom: StableId = {
        kind: "column",
        schema: (from as { schema: string }).schema,
        table: (from as { table: string }).table,
        name: (from as { name: string }).name,
      };
      if (encodeId(columnFrom) === encodeId(to)) continue;
      const columnKey = JSON.stringify([columnFrom, to]);
      if (seenEdges.has(columnKey)) continue;
      seenEdges.add(columnKey);
      edges.push({ from: columnFrom, to, kind: "depends" });
    }
  }
}
