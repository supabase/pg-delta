/** Relations and their sub-objects: tables, columns + defaults, table
 *  constraints, indexes, sequences, views + materialized views, triggers, and
 *  rewrite rules. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJson,
  aclJsonMemberAware,
  type CatalogFamily,
  memberExtensionExpr,
  notExtensionMember,
  parseAcl,
  schemaId,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

/** Canonicalize pg_class.reloptions (a text[] of `key=value`) to a sorted array
 *  so the payload hash is order-independent, or null when there are none. */
function reloptions(row: Record<string, unknown>): string[] | null {
  const raw = row["reloptions"];
  if (raw == null) return null;
  const arr = (raw as string[]).slice().sort();
  return arr.length > 0 ? arr : null;
}

const TABLES_SQL = `
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           c.relpersistence AS persistence,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security,
           c.relreplident AS replica_identity,
           (SELECT ic.relname FROM pg_index i
            JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE i.indrelid = c.oid AND i.indisreplident) AS replica_identity_index,
           CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
           c.reloptions AS reloptions,
           pg_get_expr(c.relpartbound, c.oid) AS partition_bound,
           (SELECT json_build_object('schema', pn.nspname, 'name', pc.relname)
            FROM pg_inherits inh
            JOIN pg_class pc ON pc.oid = inh.inhparent
            JOIN pg_namespace pn ON pn.oid = pc.relnamespace
            WHERE inh.inhrelid = c.oid
            -- Multi-parent support is tracked separately; until then capture the
            -- FIRST-declared parent deterministically. Without ORDER BY the
            -- unordered LIMIT 1 can pick a different parent across extractions,
            -- flapping the fact hash and causing spurious table replaces.
            ORDER BY inh.inhseqno
            LIMIT 1) AS parent_table,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJsonMemberAware("c.relacl", "r", "c.relowner", "pg_class", "c.oid")} AS acl,
           ${memberExtensionExpr("pg_class", "c.oid")} AS ext_member_of
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('r', 'p') AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, c.relname`;

export const tablesFamily: CatalogFamily = {
  name: "tables",
  statements: () => [TABLES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const id: StableId = {
        kind: "table",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
            persistence: String(row["persistence"]),
            rowSecurity: Boolean(row["row_security"]),
            forceRowSecurity: Boolean(row["force_row_security"]),
            replicaIdentity: String(row["replica_identity"]),
            replicaIdentityIndex:
              row["replica_identity_index"] == null
                ? null
                : (row["replica_identity_index"] as string),
            partitionKey:
              row["partition_key"] == null
                ? null
                : (row["partition_key"] as string),
            // partitionBound + parentTable are policy-API surface, not just hash
            // substance: the `partitionOf` predicate (src/policy/policy.ts)
            // matches on these exact payload field names. Renaming either
            // silently un-matches every partitionOf rule — no validatePolicy
            // error fires.
            partitionBound:
              row["partition_bound"] == null
                ? null
                : (row["partition_bound"] as string),
            parentTable:
              row["parent_table"] == null
                ? null
                : (row["parent_table"] as { schema: string; name: string }),
            reloptions: reloptions(row),
          },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};

// ── columns + defaults (defaults are their own facts, like pg_attrdef) ─
const COLUMNS_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
           a.attnum AS position,
           c.relkind AS table_kind,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           NULLIF(a.attidentity, '') AS identity,
           (SELECT json_build_object('schema', sn.nspname, 'name', sc.relname)
            FROM pg_depend d
            JOIN pg_class sc ON sc.oid = d.objid
            JOIN pg_namespace sn ON sn.oid = sc.relnamespace
            WHERE d.classid = 'pg_class'::regclass
              AND d.refclassid = 'pg_class'::regclass
              AND d.refobjid = c.oid AND d.refobjsubid = a.attnum
              AND d.deptype = 'i' AND sc.relkind = 'S'
            LIMIT 1) AS identity_sequence,
           (SELECT json_build_object(
                     'increment', sq.seqincrement::text, 'start', sq.seqstart::text,
                     'minValue', sq.seqmin::text, 'maxValue', sq.seqmax::text,
                     'cache', sq.seqcache::text, 'cycle', sq.seqcycle)
            FROM pg_depend d
            JOIN pg_sequence sq ON sq.seqrelid = d.objid
            WHERE d.classid = 'pg_class'::regclass
              AND d.refclassid = 'pg_class'::regclass
              AND d.refobjid = c.oid AND d.refobjsubid = a.attnum
              AND d.deptype = 'i'
            LIMIT 1) AS identity_options,
           NULLIF(a.attgenerated, '') AS generated,
           CASE WHEN a.attcollation <> t.typcollation THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = a.attcollation)
           END AS collation,
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
           col_description(c.oid, a.attnum) AS comment,
           -- column-level ACL (pg_attribute.attacl). Columns have no built-in
           -- default privileges, so acldefault('c', owner) is empty: a NULL
           -- attacl yields no acl facts, and a non-NULL one lists only explicit
           -- GRANT SELECT/INSERT/UPDATE/REFERENCES (col) entries.
           ${aclJson("a.attacl", "c", "c.relowner")} AS acl
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p', 'f') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attislocal
      AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, a.attname`;

export const columnsFamily: CatalogFamily = {
  name: "columns",
  statements: () => [COLUMNS_SQL],
  apply: (ctx, rowSets) => {
    const { facts, pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      const tableId: StableId = {
        kind: String(row["table_kind"]) === "f" ? "foreignTable" : "table",
        schema: String(row["schema"]),
        name: String(row["table"]),
      };
      const columnId: StableId = {
        kind: "column",
        schema: String(row["schema"]),
        table: String(row["table"]),
        name: String(row["name"]),
      };
      const generated = row["generated"] != null;
      pushWithMeta(
        {
          id: columnId,
          parent: tableId,
          payload: {
            // `_position` is the declared column position (pg_attribute.attnum).
            // Column ORDER is row-layout state (SELECT *, positional INSERT, the
            // relation's row type), so a from-empty CREATE must render columns in
            // this order — but positional IDENTITY is not desired state (columns
            // are name-keyed, like composite attributes), so the `_`-prefix
            // excludes it from the hash and diff (core/hash.ts, core/diff.ts): an
            // order-only reshuffle on an EXISTING table stays undiffable by design.
            // attnum has HOLES after DROP COLUMN, but ordering the survivors by it
            // still yields their declared order, which is what matters. The plan's
            // ordering phase (plan/phases/action-graph.ts) and the partitioned
            // inline-column path (plan/rules/tables.ts) render in this order.
            _position: Number(row["position"]),
            type: String(row["type"]),
            notNull: Boolean(row["not_null"]),
            identity:
              row["identity"] == null
                ? null
                : {
                    generation: row["identity"] as string,
                    sequence: row["identity_sequence"] as {
                      schema: string;
                      name: string;
                    } | null,
                    options:
                      row["identity_options"] == null
                        ? null
                        : (row["identity_options"] as {
                            increment: string;
                            start: string;
                            minValue: string;
                            maxValue: string;
                            cache: string;
                            cycle: boolean;
                          }),
                  },
            collation:
              row["collation"] == null ? null : (row["collation"] as string),
            generatedExpr:
              generated && row["default_expr"] != null
                ? (row["default_expr"] as string)
                : null,
          },
        },
        row,
      );
      if (!generated && row["default_expr"] != null) {
        facts.push({
          id: {
            kind: "default",
            schema: String(row["schema"]),
            table: String(row["table"]),
            name: String(row["name"]),
          },
          parent: columnId,
          payload: { expr: row["default_expr"] as string },
        });
      }
      // Column-level grants (attacl): one acl satellite per grantee, targeting the
      // owning relation but qualified by this column. Parent is the column so the
      // grant folds into the column/table drop, exactly like the default above.
      for (const acl of parseAcl(row["acl"])) {
        facts.push({
          id: {
            kind: "acl",
            target: tableId,
            grantee: acl.grantee,
            column: String(row["name"]),
          },
          parent: columnId,
          payload: { privileges: acl.privileges, grantable: acl.grantable },
        });
      }
    }
  },
};

const TABLE_CONSTRAINTS_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, con.conname AS name,
           c.relkind AS table_kind,
           pg_get_constraintdef(con.oid) AS def,
           con.contype AS type, con.convalidated AS validated,
           obj_description(con.oid, 'pg_constraint') AS comment
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- 'f' = foreign tables: they carry only CHECK constraints (no p/u/f/x),
    -- so the contype filter already scopes them; serialized via ALTER FOREIGN
    -- TABLE (constraintTarget keys off the parent's foreignTable kind).
    WHERE con.contype IN ('p', 'u', 'f', 'c', 'x') AND con.conislocal
      AND c.relkind IN ('r', 'p', 'f') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, con.conname`;

export const tableConstraintsFamily: CatalogFamily = {
  name: "constraints",
  statements: () => [TABLE_CONSTRAINTS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      pushWithMeta(
        {
          id: {
            kind: "constraint",
            schema: String(row["schema"]),
            table: String(row["table"]),
            name: String(row["name"]),
          },
          parent: {
            kind: String(row["table_kind"]) === "f" ? "foreignTable" : "table",
            schema: String(row["schema"]),
            name: String(row["table"]),
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
  },
};

// ── indexes (excluding constraint-backed ones) ───────────────────────
const INDEXES_SQL = `
    SELECT n.nspname AS schema, ic.relname AS name, c.relname AS table,
           c.relkind AS table_kind,
           pg_get_indexdef(i.indexrelid) AS def,
           -- A partitioned PARENT index (relkind 'I') is legitimately
           -- indisvalid=false whenever a child index is unattached, and
           -- pg_get_indexdef renders it as CREATE INDEX ... ON ONLY ..., which
           -- itself produces an invalid parent (children attach separately). So
           -- its indisvalid is attach-state, not repair-worthy corruption:
           -- force it valid here so it never drives a diff (the unmodeled
           -- attach-state stays tracked in #332). Only REGULAR indexes ('i')
           -- carry their real indisvalid, which is what catches a failed
           -- CREATE INDEX CONCURRENTLY.
           CASE WHEN ic.relkind = 'I' THEN true ELSE i.indisvalid END AS valid,
           obj_description(i.indexrelid, 'pg_class') AS comment
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    WHERE c.relkind IN ('r', 'p', 'm') AND ${USER_SCHEMA_FILTER}
      -- Exclude indexes OWNED by a constraint (PRIMARY KEY / UNIQUE / EXCLUSION),
      -- which are serialized via the constraint, not as standalone CREATE INDEX.
      -- Gate on contype: a FOREIGN KEY constraint also sets conindid — to the
      -- index on the REFERENCED table it depends on — so an unqualified check
      -- wrongly drops a standalone unique index the moment any FK references it
      -- (regression: realtime.tenants' unique index on external_id, referenced by
      -- an FK from _realtime.extensions, vanished from extraction).
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint pc
        WHERE pc.conindid = i.indexrelid AND pc.contype IN ('p', 'u', 'x')
      )
      AND NOT EXISTS (SELECT 1 FROM pg_inherits ih WHERE ih.inhrelid = i.indexrelid)
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, ic.relname`;

export const indexesFamily: CatalogFamily = {
  name: "indexes",
  statements: () => [INDEXES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      const tableKind =
        String(row["table_kind"]) === "m" ? "materializedView" : "table";
      pushWithMeta(
        {
          id: {
            kind: "index",
            schema: String(row["schema"]),
            name: String(row["name"]),
          },
          parent: {
            kind: tableKind,
            schema: String(row["schema"]),
            name: String(row["table"]),
          },
          // `valid` (pg_index.indisvalid) is SEMANTIC state, not just metadata: a
          // failed/cancelled CREATE INDEX CONCURRENTLY leaves indisvalid=false with
          // a def IDENTICAL to the desired valid index, so without this field the
          // unusable index would hash EQUAL to the valid one and retry planning /
          // the proof would consider it converged. Including it in the payload
          // (hashed) makes invalid ≠ valid, and the `valid: "replace"` attribute
          // strategy repairs it via drop + recreate (the standard fix). A fresh
          // CREATE INDEX in a SQL-loaded shadow is always valid=true, so the desired
          // side naturally carries true and never churns a healthy index.
          //
          // NOTE (#332): the `valid` SELECT above deliberately forces partitioned
          // PARENT indexes (relkind 'I') to true. Their indisvalid tracks child
          // ATTACH-state (and pg_get_indexdef renders them `ON ONLY`, which itself
          // produces an invalid parent), so surfacing it here would spuriously
          // fail convergence on every partitioned-index scenario. That attach-state
          // remains unmodeled and tracked in #332; only regular indexes drive the
          // valid diff.
          payload: { def: String(row["def"]), valid: Boolean(row["valid"]) },
        },
        row,
      );
    }
  },
};

// ── sequences (identity-column internals excluded) ───────────────────
const SEQUENCES_SQL = `
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           format_type(s.seqtypid, NULL) AS data_type,
           s.seqstart::text AS start, s.seqincrement::text AS increment,
           s.seqmin::text AS min_value, s.seqmax::text AS max_value,
           s.seqcache::text AS cache, s.seqcycle AS cycle,
           (SELECT json_build_object('schema', tn.nspname, 'table', tc.relname,
                                     'column', ta.attname)
            FROM pg_depend od
            JOIN pg_class tc ON tc.oid = od.refobjid
            JOIN pg_namespace tn ON tn.oid = tc.relnamespace
            JOIN pg_attribute ta ON ta.attrelid = tc.oid AND ta.attnum = od.refobjsubid
            WHERE od.classid = 'pg_class'::regclass AND od.objid = c.oid
              AND od.refclassid = 'pg_class'::regclass AND od.deptype = 'a'
              AND od.refobjsubid > 0
            LIMIT 1) AS owned_by,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJsonMemberAware("c.relacl", "s", "c.relowner", "pg_class", "c.oid")} AS acl,
           ${memberExtensionExpr("pg_class", "c.oid")} AS ext_member_of
    FROM pg_sequence s
    JOIN pg_class c ON c.oid = s.seqrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE ${USER_SCHEMA_FILTER}
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.deptype = 'i')
    ORDER BY n.nspname, c.relname`;

export const sequencesFamily: CatalogFamily = {
  name: "sequences",
  statements: () => [SEQUENCES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const id: StableId = {
        kind: "sequence",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
            dataType: String(row["data_type"]),
            start: String(row["start"]),
            increment: String(row["increment"]),
            minValue: String(row["min_value"]),
            maxValue: String(row["max_value"]),
            cache: String(row["cache"]),
            cycle: Boolean(row["cycle"]),
            ownedBy:
              row["owned_by"] == null
                ? null
                : (row["owned_by"] as {
                    schema: string;
                    table: string;
                    column: string;
                  }),
          },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};

// ── views + materialized views ───────────────────────────────────────
const VIEWS_SQL = `
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           c.relkind AS kind,
           pg_get_viewdef(c.oid) AS def,
           c.reloptions AS reloptions,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJsonMemberAware("c.relacl", "r", "c.relowner", "pg_class", "c.oid")} AS acl,
           ${memberExtensionExpr("pg_class", "c.oid")} AS ext_member_of
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('v', 'm') AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, c.relname`;

export const viewsFamily: CatalogFamily = {
  name: "views",
  statements: () => [VIEWS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const id: StableId = {
        kind: String(row["kind"]) === "m" ? "materializedView" : "view",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: { def: String(row["def"]), reloptions: reloptions(row) },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};

const TRIGGERS_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name,
           c.relkind AS table_kind,
           pg_get_triggerdef(t.oid) AS def,
           t.tgenabled AS enabled,
           obj_description(t.oid, 'pg_trigger') AS comment
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND t.tgparentid = 0 AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, t.tgname`;

export const triggersFamily: CatalogFamily = {
  name: "triggers",
  statements: () => [TRIGGERS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      const relkind = String(row["table_kind"]);
      pushWithMeta(
        {
          id: {
            kind: "trigger",
            schema: String(row["schema"]),
            table: String(row["table"]),
            name: String(row["name"]),
          },
          parent: {
            kind:
              relkind === "v"
                ? "view"
                : relkind === "m"
                  ? "materializedView"
                  : relkind === "f"
                    ? "foreignTable"
                    : "table",
            schema: String(row["schema"]),
            name: String(row["table"]),
          },
          payload: {
            def: String(row["def"]),
            enabled: String(row["enabled"]),
          },
        },
        row,
      );
    }
  },
};

// ── rewrite rules (user rules; the view _RETURN rule is the view def) ─
const RULES_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, c.relkind AS table_kind,
           rw.rulename AS name, pg_get_ruledef(rw.oid) AS def,
           rw.ev_enabled AS enabled,
           obj_description(rw.oid, 'pg_rewrite') AS comment
    FROM pg_rewrite rw
    JOIN pg_class c ON c.oid = rw.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE rw.rulename <> '_RETURN' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, rw.rulename`;

export const rulesFamily: CatalogFamily = {
  name: "rules",
  statements: () => [RULES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      const relkind = String(row["table_kind"]);
      pushWithMeta(
        {
          id: {
            kind: "rule",
            schema: String(row["schema"]),
            table: String(row["table"]),
            name: String(row["name"]),
          },
          parent: {
            kind:
              relkind === "v"
                ? "view"
                : relkind === "m"
                  ? "materializedView"
                  : "table",
            schema: String(row["schema"]),
            name: String(row["table"]),
          },
          payload: { def: String(row["def"]), enabled: String(row["enabled"]) },
        },
        row,
      );
    }
  },
};
