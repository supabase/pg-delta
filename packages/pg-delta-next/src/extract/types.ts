/** User-defined types: domains (+ their CHECK constraints), enums / composites
 *  / ranges, and collations. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJsonMemberAware,
  type ExtractContext,
  memberExtensionExpr,
  notExtensionMember,
  parseAcl,
  schemaId,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

export async function extractDomains(ctx: ExtractContext): Promise<void> {
  const { q, pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
  // ── domains (+ their CHECK constraints as facts) ─────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           format_type(t.typbasetype, t.typtypmod) AS base_type,
           t.typnotnull AS not_null, t.typdefault AS default_expr,
           CASE WHEN t.typcollation <> bt.typcollation THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = t.typcollation)
           END AS collation,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJsonMemberAware("t.typacl", "T", "t.typowner", "pg_type", "t.oid")} AS acl,
           ${memberExtensionExpr("pg_type", "t.oid")} AS ext_member_of
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    JOIN pg_type bt ON bt.oid = t.typbasetype
    WHERE t.typtype = 'd' AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, t.typname`)) {
    const id: StableId = {
      kind: "domain",
      schema: String(row["schema"]),
      name: String(row["name"]),
    };
    pushWithMeta(
      {
        id,
        parent: schemaId(row["schema"]),
        payload: {
          baseType: String(row["base_type"]),
          notNull: Boolean(row["not_null"]),
          default:
            row["default_expr"] == null
              ? null
              : (row["default_expr"] as string),
          collation:
            row["collation"] == null ? null : (row["collation"] as string),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushMemberEdge(id, row);
    pushOwnerEdge(id, row["owner"]);
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS domain, con.conname AS name,
           pg_get_constraintdef(con.oid) AS def,
           con.contype AS type, con.convalidated AS validated,
           obj_description(con.oid, 'pg_constraint') AS comment
    FROM pg_constraint con
    JOIN pg_type t ON t.oid = con.contypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE con.contypid <> 0 AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_type", "t.oid")}
    ORDER BY n.nspname, t.typname, con.conname`)) {
    pushWithMeta(
      {
        id: {
          kind: "constraint",
          schema: String(row["schema"]),
          table: String(row["domain"]),
          name: String(row["name"]),
        },
        parent: {
          kind: "domain",
          schema: String(row["schema"]),
          name: String(row["domain"]),
        },
        payload: {
          def: String(row["def"]),
          type: String(row["type"]),
          validated: Boolean(row["validated"]),
        },
      },
      row,
    );
  }
}

export async function extractTypes(ctx: ExtractContext): Promise<void> {
  const { q, facts, pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
  // ── types: enums, standalone composites, ranges ──────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           ARRAY(SELECT e.enumlabel::text FROM pg_enum e
                 WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder) AS values,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJsonMemberAware("t.typacl", "T", "t.typowner", "pg_type", "t.oid")} AS acl,
           ${memberExtensionExpr("pg_type", "t.oid")} AS ext_member_of
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    WHERE t.typtype = 'e' AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, t.typname`)) {
    const id: StableId = {
      kind: "type",
      schema: String(row["schema"]),
      name: String(row["name"]),
    };
    pushWithMeta(
      {
        id,
        parent: schemaId(row["schema"]),
        payload: {
          variant: "enum",
          values: (row["values"] as string[]).map(String),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushMemberEdge(id, row);
    pushOwnerEdge(id, row["owner"]);
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           (SELECT json_agg(json_build_object(
              'name', a.attname,
              'type', format_type(a.atttypid, a.atttypmod),
              'collation', CASE WHEN a.attcollation <> at.typcollation THEN (
                SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
                FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
                WHERE co.oid = a.attcollation) END
            ) ORDER BY a.attnum)
            FROM pg_attribute a
            JOIN pg_type at ON at.oid = a.atttypid
            WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) AS attrs,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJsonMemberAware("t.typacl", "T", "t.typowner", "pg_type", "t.oid")} AS acl,
           ${memberExtensionExpr("pg_type", "t.oid")} AS ext_member_of
    FROM pg_type t
    JOIN pg_class tc ON tc.oid = t.typrelid AND tc.relkind = 'c'
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    WHERE t.typtype = 'c' AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, t.typname`)) {
    const typeId: StableId = {
      kind: "type",
      schema: String(row["schema"]),
      name: String(row["name"]),
    };
    pushWithMeta(
      {
        id: typeId,
        parent: schemaId(row["schema"]),
        payload: { variant: "composite" },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushMemberEdge(typeId, row);
    pushOwnerEdge(typeId, row["owner"]);
    // each attribute is its own fact (granularity is one, §3.1) — enables
    // attribute-grain diffs and ALTER TYPE … RENAME ATTRIBUTE rename
    // detection. Positional order is not desired state (mirrors columns).
    const attrs =
      (row["attrs"] as
        | { name: string; type: string; collation: string | null }[]
        | null) ?? [];
    for (const a of attrs) {
      facts.push({
        id: {
          kind: "typeAttribute",
          schema: String(row["schema"]),
          type: String(row["name"]),
          name: a.name,
        },
        parent: typeId,
        payload: { type: a.type, collation: a.collation ?? null },
      });
    }
  }
  // rngmultitypid (the auto-created multirange type) is PG14+; on PG13 the
  // column does not exist, so the multirange name degrades to NULL.
  const major = Math.floor(
    Number(
      (
        await q(`SELECT current_setting('server_version_num')::int AS num`)
      )[0]?.["num"] ?? 0,
    ) / 10000,
  );
  const multirangeExpr =
    major >= 14
      ? `(SELECT quote_ident(mn.nspname) || '.' || quote_ident(mt.typname)
            FROM pg_type mt JOIN pg_namespace mn ON mn.oid = mt.typnamespace
            WHERE mt.oid = rng.rngmultitypid)`
      : `NULL::text`;
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           format_type(rng.rngsubtype, NULL) AS subtype,
           -- pin SUBTYPE_OPCLASS only when it is not the subtype's default
           -- operator class (pg_dump's rule); the default is implied by SUBTYPE
           CASE WHEN NOT opc.opcdefault THEN
             quote_ident(opcn.nspname) || '.' || quote_ident(opc.opcname)
           END AS subtype_opclass,
           CASE WHEN rng.rngcollation <> 0 THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = rng.rngcollation) END AS collation,
           CASE WHEN rng.rngsubdiff <> 0 THEN rng.rngsubdiff::regproc::text END AS subtype_diff,
           ${multirangeExpr} AS multirange_type_name,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJsonMemberAware("t.typacl", "T", "t.typowner", "pg_type", "t.oid")} AS acl,
           ${memberExtensionExpr("pg_type", "t.oid")} AS ext_member_of
    FROM pg_range rng
    JOIN pg_type t ON t.oid = rng.rngtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    JOIN pg_opclass opc ON opc.oid = rng.rngsubopc
    JOIN pg_namespace opcn ON opcn.oid = opc.opcnamespace
    WHERE t.typtype = 'r' AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, t.typname`)) {
    const id: StableId = {
      kind: "type",
      schema: String(row["schema"]),
      name: String(row["name"]),
    };
    pushWithMeta(
      {
        id,
        parent: schemaId(row["schema"]),
        payload: {
          variant: "range",
          subtype: String(row["subtype"]),
          subtypeOpclass:
            row["subtype_opclass"] == null
              ? null
              : (row["subtype_opclass"] as string),
          collation:
            row["collation"] == null ? null : (row["collation"] as string),
          subtypeDiff:
            row["subtype_diff"] == null
              ? null
              : (row["subtype_diff"] as string),
          multirangeTypeName:
            row["multirange_type_name"] == null
              ? null
              : (row["multirange_type_name"] as string),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushMemberEdge(id, row);
    pushOwnerEdge(id, row["owner"]);
  }
}

export async function extractCollations(ctx: ExtractContext): Promise<void> {
  const { q, pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
  // ── collations (collversion deliberately excluded from equality) ─────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.collname AS name, r.rolname AS owner,
           c.collprovider AS provider, c.collisdeterministic AS deterministic,
           to_jsonb(c) AS raw,
           obj_description(c.oid, 'pg_collation') AS comment,
           ${memberExtensionExpr("pg_collation", "c.oid")} AS ext_member_of
    FROM pg_collation c
    JOIN pg_namespace n ON n.oid = c.collnamespace
    JOIN pg_roles r ON r.oid = c.collowner
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, c.collname`)) {
    const raw = row["raw"] as Record<string, unknown>;
    const locale =
      (raw["colllocale"] as string | null) ??
      (raw["colliculocale"] as string | null) ??
      null;
    const id: StableId = {
      kind: "collation",
      schema: String(row["schema"]),
      name: String(row["name"]),
    };
    pushWithMeta(
      {
        id,
        parent: schemaId(row["schema"]),
        payload: {
          provider: String(row["provider"]),
          deterministic: Boolean(row["deterministic"]),
          locale,
          lcCollate: (raw["collcollate"] as string | null) ?? null,
          lcCtype: (raw["collctype"] as string | null) ?? null,
        },
      },
      row,
    );
    pushMemberEdge(id, row);
    pushOwnerEdge(id, row["owner"]);
  }
}
