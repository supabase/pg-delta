/** Publications (+ their table / schema member facts) and subscriptions. */
import type { StableId } from "../core/stable-id.ts";
import { type ExtractContext, notExtensionMember } from "./scope.ts";
import { SUBSCRIPTION_CONNINFO_PLACEHOLDER } from "./sensitive-options.ts";

export async function extractPublications(ctx: ExtractContext): Promise<void> {
  const { q, facts, pushWithMeta, pushOwnerEdge } = ctx;
  // Publication column lists (pg_publication_rel.prattrs), row filters
  // (pr.prqual), and schema membership (pg_publication_namespace) are all
  // PostgreSQL 15+. On PG14 those catalog columns / relations do not exist, so
  // the query degrades to bare table membership (no column list / WHERE, no
  // schema publications) — exactly the publication feature set PG14 has.
  const major = Math.floor(
    Number(
      (
        await q(`SELECT current_setting('server_version_num')::int AS num`)
      )[0]?.["num"] ?? 0,
    ) / 10000,
  );
  const columnsExpr =
    major >= 15
      ? `(SELECT array_agg(att.attname::text ORDER BY att.attname)
                          FROM unnest(pr.prattrs) WITH ORDINALITY AS pa(attnum, ord)
                          JOIN pg_attribute att ON att.attrelid = pc.oid AND att.attnum = pa.attnum)`
      : `NULL`;
  const whereExpr = major >= 15 ? `pg_get_expr(pr.prqual, pr.prrelid)` : `NULL`;
  const schemasExpr =
    major >= 15
      ? `(SELECT array_agg(pn2.nspname::text ORDER BY 1)
            FROM pg_publication_namespace pns
            JOIN pg_namespace pn2 ON pn2.oid = pns.pnnspid
            WHERE pns.pnpubid = p.oid)`
      : `NULL::text[]`;
  // ── publications ─────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT p.pubname AS name, r.rolname AS owner,
           p.puballtables AS all_tables, p.pubviaroot AS via_root,
           p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
           (SELECT json_agg(json_build_object(
              'schema', pn.nspname, 'name', pc.relname,
              'columns', ${columnsExpr},
              'where', ${whereExpr}
            ) ORDER BY pn.nspname, pc.relname)
            FROM pg_publication_rel pr
            JOIN pg_class pc ON pc.oid = pr.prrelid
            JOIN pg_namespace pn ON pn.oid = pc.relnamespace
            WHERE pr.prpubid = p.oid) AS tables,
           ${schemasExpr} AS schemas,
           obj_description(p.oid, 'pg_publication') AS comment
    FROM pg_publication p
    JOIN pg_roles r ON r.oid = p.pubowner
    WHERE ${notExtensionMember("pg_publication", "p.oid")}
    ORDER BY p.pubname`)) {
    const publish: string[] = [];
    if (row["pubinsert"]) publish.push("insert");
    if (row["pubupdate"]) publish.push("update");
    if (row["pubdelete"]) publish.push("delete");
    if (row["pubtruncate"]) publish.push("truncate");
    const pubName = String(row["name"]);
    const pubId: StableId = { kind: "publication", name: pubName };
    pushWithMeta(
      {
        id: pubId,
        payload: {
          allTables: Boolean(row["all_tables"]),
          viaRoot: Boolean(row["via_root"]),
          publish,
        },
      },
      row,
    );
    pushOwnerEdge(pubId, row["owner"]);
    // each published table / schema is its own fact (granularity is one):
    // members are managed with ALTER PUBLICATION ADD/DROP, and a column-list
    // or WHERE change diffs at table grain instead of churning the whole
    // publication payload.
    const tables =
      (row["tables"] as
        | {
            schema: string;
            name: string;
            columns: string[] | null;
            where: string | null;
          }[]
        | null) ?? [];
    for (const t of tables) {
      facts.push({
        id: {
          kind: "publicationRel",
          publication: pubName,
          schema: t.schema,
          table: t.name,
        },
        parent: pubId,
        payload: {
          columns: t.columns == null ? null : t.columns.map(String),
          where: t.where ?? null,
        },
      });
    }
    for (const s of ((row["schemas"] as string[] | null) ?? []).map(String)) {
      facts.push({
        id: { kind: "publicationSchema", publication: pubName, schema: s },
        parent: pubId,
        payload: {},
      });
    }
  }
}

export async function extractSubscriptions(ctx: ExtractContext): Promise<void> {
  const { q, pushWithMeta, pushOwnerEdge } = ctx;
  const major = Math.floor(
    Number(
      (
        await q(`SELECT current_setting('server_version_num')::int AS num`)
      )[0]?.["num"] ?? 0,
    ) / 10000,
  );
  // substream is boolean on PG15 (on/off) and a "char" on PG16+ ('f'/'t'/'p',
  // 'p' = parallel). Normalise to the CREATE/ALTER keyword in SQL.
  const streamingExpr =
    major >= 16
      ? `CASE s.substream WHEN 'p' THEN 'parallel' WHEN 't' THEN 'on' ELSE 'off' END`
      : `CASE WHEN s.substream THEN 'on' ELSE 'off' END`;
  // disable_on_error and two_phase are PG15+; run_as_owner and origin are
  // PG16+ — NULL on older servers so the rule omits them entirely. (binary and
  // streaming are PG14+ and synchronous_commit is PG10+, so they need no gate
  // for our supported range.)
  const disableOnErrorExpr =
    major >= 15 ? `s.subdisableonerr` : `NULL::boolean`;
  const twoPhaseExpr =
    major >= 15 ? `(s.subtwophasestate <> 'd')` : `NULL::boolean`;
  const runAsOwnerExpr = major >= 16 ? `s.subrunasowner` : `NULL::boolean`;
  const originExpr = major >= 16 ? `s.suborigin` : `NULL::text`;
  // `subconninfo` is revoked from non-superusers by default (unlike every
  // other pg_subscription column, which PUBLIC can read) — selecting it
  // unconditionally makes the WHOLE query fail `permission denied for table
  // pg_subscription` for such a caller. Postgres's column permission check is
  // static (keyed on which columns the query TEXT references, independent of
  // matched rows), so a runtime `CASE WHEN has_column_privilege(...) THEN
  // s.subconninfo ELSE NULL END` does NOT work — the column reference alone
  // still trips the check. Gate it the same way `major` gates version-specific
  // columns above: probe once, then build the column reference conditionally.
  const conninfoReadable = Boolean(
    (
      await q(
        `SELECT has_column_privilege('pg_subscription', 'subconninfo', 'SELECT') AS ok`,
      )
    )[0]?.["ok"],
  );
  const conninfoExpr = conninfoReadable ? "s.subconninfo" : "NULL::text";
  // ── subscriptions (database-local rows only) ─────────────────────────
  for (const row of await q(`
    SELECT s.subname AS name, r.rolname AS owner, s.subenabled AS enabled,
           ${conninfoExpr} AS conninfo, s.subslotname AS slot_name,
           s.subpublications::text[] AS publications,
           s.subbinary AS binary,
           ${streamingExpr} AS streaming,
           s.subsynccommit AS synchronous_commit,
           ${disableOnErrorExpr} AS disable_on_error,
           ${twoPhaseExpr} AS two_phase,
           ${runAsOwnerExpr} AS run_as_owner,
           ${originExpr} AS origin,
           obj_description(s.oid, 'pg_subscription') AS comment
    FROM pg_subscription s
    JOIN pg_roles r ON r.oid = s.subowner
    JOIN pg_database d ON d.oid = s.subdbid
    WHERE d.datname = current_database()
    ORDER BY s.subname`)) {
    const subId: StableId = { kind: "subscription", name: String(row["name"]) };
    pushWithMeta(
      {
        id: subId,
        payload: {
          enabled: Boolean(row["enabled"]),
          // conninfo is fully env-dependent and carries credentials — emit the
          // placeholder unless the caller explicitly opted out of redaction
          // (see sensitive-options.ts). `row["conninfo"]` is also null when
          // this role lacks column privilege on subconninfo (conninfoExpr
          // above) — the real value is unrecoverable either way, so that also
          // falls back to the placeholder rather than the string "null".
          conninfo:
            ctx.redactSecrets || row["conninfo"] == null
              ? SUBSCRIPTION_CONNINFO_PLACEHOLDER
              : (row["conninfo"] as string),
          slotName:
            row["slot_name"] == null ? null : (row["slot_name"] as string),
          publications: (row["publications"] as string[]).map(String).sort(),
          binary: Boolean(row["binary"]),
          streaming: String(row["streaming"]),
          synchronousCommit: String(row["synchronous_commit"]),
          disableOnError:
            row["disable_on_error"] == null
              ? null
              : Boolean(row["disable_on_error"]),
          twoPhase: row["two_phase"] == null ? null : Boolean(row["two_phase"]),
          runAsOwner:
            row["run_as_owner"] == null ? null : Boolean(row["run_as_owner"]),
          origin: row["origin"] == null ? null : (row["origin"] as string),
        },
      },
      row,
    );
    pushOwnerEdge(subId, row["owner"]);
  }
}
