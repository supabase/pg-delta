/**
 * Parity / inventory harness for the provenance flip (4b Stage 1).
 * Docker required (the Supabase image, which ships rich extensions).
 *
 * This is an INDEPENDENT oracle: it asks pg_depend directly which objects are
 * extension members (deptype 'e') of a modeled kind — the set the extractor
 * historically removed with `notExtensionMember` — and checks the flipped
 * extractor against it, family by family:
 *
 *   - soundness (enforced for every flipped family, always): every observed
 *     fact that the catalog says is an extension member MUST carry an outgoing
 *     `memberOfExtension` edge. A family flipped WITHOUT emitting the edge would
 *     leak an untagged member past the default projection — this catches it.
 *   - completeness (per kind in FLIPPED_KINDS): every catalog member of a
 *     flipped kind MUST be observed as a fact. This is what goes RED before a
 *     family is flipped and GREEN after — the per-family migration signal.
 *
 * FLIPPED_KINDS grows in Stage 2 as each extractor family is flipped. Before a
 * kind is flipped its members are absent (filtered), so completeness is not yet
 * asserted for it; soundness is asserted unconditionally (absent members are
 * vacuously sound).
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import type { FactBase } from "../src/core/fact.ts";
import { encodeId, type StableId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { supabaseCluster, type TestDb } from "./containers.ts";

/** Member kinds whose extractor family has been flipped (Stage 2). The
 *  member-ROOT families are flipped; sub-entity families (columns, constraints,
 *  indexes, triggers, policies, rules) and rare member-root kinds (fdw, server,
 *  foreignTable, eventTrigger, publication) keep their anti-joins for now — a
 *  documented, regression-free limitation (COVERAGE.md). */
const FLIPPED_KINDS: ReadonlySet<string> = new Set<string>([
  "schema",
  "table",
  "sequence",
  "view",
  "materializedView",
  "function", // routines family: functions ('f')
  "procedure", // routines family: procedures ('p')
  "aggregate",
  "domain",
  "type", // enum, composite, range
  "collation",
]);

/** Independent oracle: every extension member (deptype 'e') of a modeled kind,
 *  resolved to (kind, identity) WITHOUT collapsing to the extension. Mirrors the
 *  resolver's fallback branches but is deliberately a separate query so it can
 *  disagree with the code under test. */
async function catalogMembers(
  pool: Pool,
): Promise<{ id: StableId; extension: string }[]> {
  // mirror the extractor's scope: user schemas only, and plpgsql is not a
  // tracked extension (memberExtensionExpr / the extensions extractor skip it)
  const userNs = (col: string) =>
    `${col} NOT IN ('pg_catalog', 'information_schema')
       AND ${col} NOT LIKE 'pg\\_toast%' AND ${col} NOT LIKE 'pg\\_temp%'`;
  // mirror the extractor's canonical session too: extraction runs under
  // `search_path = pg_catalog`, so format_type schema-qualifies user types
  // (`public.hstore`, not `hstore`). This oracle must format identity args the
  // same way or its join keys never match the extracted fact ids.
  const client = await pool.connect();
  let rows: { ident: Record<string, unknown>; ext: string }[];
  try {
    await client.query(`BEGIN`);
    await client.query(`SET LOCAL search_path TO 'pg_catalog'`);
    ({ rows } = await client.query<{
      ident: Record<string, unknown>;
      ext: string;
    }>(`
    SELECT ident, ext FROM (
      -- relations: tables, views, matviews, sequences (indexes 'i','I' skipped:
      -- not standalone facts in the member sense for parity)
      SELECT json_build_object(
               'kind', CASE c.relkind
                         WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
                         WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView'
                         WHEN 'S' THEN 'sequence' END,
               'schema', n.nspname, 'name', c.relname) AS ident,
             e.extname AS ext
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      JOIN pg_class c ON c.oid = d.objid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.deptype = 'e' AND d.classid = 'pg_class'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND c.relkind IN ('r','p','v','m','S')
        AND e.extname <> 'plpgsql' AND ${userNs("n.nspname")}
      UNION ALL
      -- routines (functions → 'function', procedures → 'procedure',
      -- aggregates → 'aggregate'), minus those that are an internal dependency
      -- (type I/O etc.): the extractor excludes deptype 'i', so they are not
      -- standalone facts
      SELECT json_build_object(
               'kind', CASE p.prokind WHEN 'a' THEN 'aggregate' WHEN 'p' THEN 'procedure' ELSE 'function' END,
               'schema', n.nspname, 'name', p.proname,
               'args', ARRAY(SELECT format_type(t.t, NULL)
                             FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                             ORDER BY t.ord)::text[]) AS ident,
             e.extname AS ext
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      JOIN pg_proc p ON p.oid = d.objid
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE d.deptype = 'e' AND d.classid = 'pg_proc'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND p.prokind IN ('f','p','a')
        AND e.extname <> 'plpgsql' AND ${userNs("n.nspname")}
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend idep
          WHERE idep.classid = 'pg_proc'::regclass AND idep.objid = p.oid
            AND idep.deptype = 'i')
      UNION ALL
      -- types and domains
      SELECT json_build_object(
               'kind', CASE t.typtype WHEN 'd' THEN 'domain' ELSE 'type' END,
               'schema', n.nspname, 'name', t.typname) AS ident,
             e.extname AS ext
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      JOIN pg_type t ON t.oid = d.objid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE d.deptype = 'e' AND d.classid = 'pg_type'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND t.typtype IN ('d','e','c','r')
        -- skip the implicit array types extensions drag in (they are not facts)
        AND t.typname NOT LIKE '\\_%'
        -- skip TABLE rowtypes: a member table's rowtype is typtype 'c' but is
        -- not a standalone composite-type fact (the extractor requires the
        -- backing relation to be relkind 'c'); the table itself is the fact
        AND (t.typtype <> 'c' OR EXISTS (
              SELECT 1 FROM pg_class tc
              WHERE tc.oid = t.typrelid AND tc.relkind = 'c'))
        AND e.extname <> 'plpgsql' AND ${userNs("n.nspname")}
      UNION ALL
      -- schemas owned by an extension
      SELECT json_build_object('kind', 'schema', 'name', n.nspname) AS ident,
             e.extname AS ext
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      JOIN pg_namespace n ON n.oid = d.objid
      WHERE d.deptype = 'e' AND d.classid = 'pg_namespace'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND e.extname <> 'plpgsql' AND ${userNs("n.nspname")}
      UNION ALL
      -- collations
      SELECT json_build_object('kind', 'collation', 'schema', n.nspname,
                               'name', cl.collname) AS ident,
             e.extname AS ext
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      JOIN pg_collation cl ON cl.oid = d.objid
      JOIN pg_namespace n ON n.oid = cl.collnamespace
      WHERE d.deptype = 'e' AND d.classid = 'pg_collation'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND e.extname <> 'plpgsql' AND ${userNs("n.nspname")}
    ) m
    ORDER BY ident::text`));
    await client.query(`COMMIT`);
  } finally {
    client.release();
  }
  return rows.map((r) => ({ id: identToStableId(r.ident), extension: r.ext }));
}

function identToStableId(o: Record<string, unknown>): StableId {
  const kind = String(o["kind"]);
  switch (kind) {
    case "schema":
      return { kind: "schema", name: String(o["name"]) };
    case "table":
    case "view":
    case "materializedView":
    case "sequence":
    case "type":
    case "domain":
    case "collation":
      return {
        kind,
        schema: String(o["schema"]),
        name: String(o["name"]),
      };
    case "function":
    case "procedure":
    case "aggregate":
      return {
        kind,
        schema: String(o["schema"]),
        name: String(o["name"]),
        args: (o["args"] as string[]).map(String),
      };
    default:
      throw new Error(`parity oracle: unmapped kind ${kind}`);
  }
}

/** every fact id that carries an outgoing memberOfExtension edge */
function taggedMemberIds(fb: FactBase): Set<string> {
  const tagged = new Set<string>();
  for (const e of fb.edges) {
    if (e.kind === "memberOfExtension") tagged.add(encodeId(e.from));
  }
  return tagged;
}

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("extension-member parity (4b Stage 1/2)", () => {
  test("every observed extension member is tagged; flipped kinds are fully observed", async () => {
    const cluster = await supabaseCluster();
    const db = await cluster.createDb("member_parity");
    dbs.push(db);

    // install extensions that own members across several families:
    //  - pg_partman: functions (procedure) + config tables (table)
    //  - hstore / citext: a type each, plus functions and operators
    await db.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await db.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await db.pool.query(`CREATE EXTENSION IF NOT EXISTS hstore`);
    await db.pool.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    const members = await catalogMembers(db.pool);
    const fb = (await extract(db.pool)).factBase;

    const present = new Set(fb.facts().map((f) => encodeId(f.id)));
    const tagged = taggedMemberIds(fb);

    // soundness: any catalog member that IS observed must be tagged
    const untagged = members.filter(
      (m) => present.has(encodeId(m.id)) && !tagged.has(encodeId(m.id)),
    );
    expect(untagged.map((m) => encodeId(m.id))).toEqual([]);

    // completeness: for each flipped kind, every catalog member is observed
    const missing = members.filter(
      (m) => FLIPPED_KINDS.has(m.id.kind) && !present.has(encodeId(m.id)),
    );
    expect(missing.map((m) => encodeId(m.id))).toEqual([]);

    // sanity: the oracle actually found members (guards a silent empty oracle)
    expect(members.length).toBeGreaterThan(0);
  }, 180_000);
});
