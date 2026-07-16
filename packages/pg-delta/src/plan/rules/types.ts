/** Rule definitions for domains, user-defined types (enum / composite / range),
 *  composite-type attributes, and collations. */
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { lit, qid, rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import {
  compositeUserColumns,
  isSubsequence,
  p,
  renameRule,
  str,
  typeAttributeClause,
} from "./helpers.ts";

export const typeRules: Record<string, KindRules> = {
  domain: {
    weight: 7,
    cascadesToChildren: true,
    defaclObjtype: "T", // ALTER DEFAULT PRIVILEGES … ON TYPES covers domains
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER DOMAIN ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view, _params, sourceView) => {
      const id = fact.id as { schema: string; name: string };
      const relName = rel(id.schema, id.name);
      // GUARD (baseType/collation replace): both attributes are "replace", so
      // any change drops and recreates the domain. A table column is NOT a
      // rebuildable kind, so if a SURVIVING user column depends on this domain
      // PostgreSQL rejects the DROP at apply ("cannot drop type … other
      // objects depend on it"). Fail loud at plan time — mirrors the in-use
      // range-type guard above (§ type rule) and the in-use composite ALTER
      // ATTRIBUTE guard below. Only a REPLACE (the domain is present in the
      // source) can hit this; a fresh create brings its columns with it.
      if (sourceView?.get(fact.id) !== undefined) {
        const inUse = compositeUserColumns(view, fact.id).filter(
          (colId) => sourceView.get(colId) !== undefined,
        );
        if (inUse.length > 0) {
          const cols = inUse
            .map((c) => {
              const col = c as { schema: string; table: string; name: string };
              return `${rel(col.schema, col.table)}.${qid(col.name)}`;
            })
            .join(", ");
          throw new Error(
            `domain ${relName}: cannot replace an in-use domain — column(s) ${cols} depend on it, and PostgreSQL forbids dropping a type while a column uses it. Replacing an in-use domain is not supported yet; drop the using column(s), or recreate the domain, first.`,
          );
        }
      }
      let sql = `CREATE DOMAIN ${relName} AS ${str(p(fact, "baseType"))}`;
      const collation = p(fact, "collation");
      if (collation != null) sql += ` COLLATE ${str(collation)}`;
      const def = p(fact, "default");
      if (def != null) sql += ` DEFAULT ${str(def)}`;
      if (p(fact, "notNull")) sql += ` NOT NULL`;
      // Inline CHECK constraints into the CREATE (delta-set, like composite
      // attributes): a domain already used by a composite type or table column
      // cannot be ALTERed to add a constraint ("cannot alter type … because
      // column … uses it"), so the constraint must exist at creation time. Their
      // standalone ADD is then skipped via alsoProduces. A constraint CHANGE on
      // an EXISTING domain still flows through the ALTER DOMAIN constraint path.
      //
      // EXCEPTION: a NOT VALID constraint (convalidated = false) cannot be
      // expressed inline — `pg_get_constraintdef()` returns "… NOT VALID" and
      // PostgreSQL only accepts NOT VALID on `ALTER DOMAIN … ADD CONSTRAINT`,
      // never on CREATE DOMAIN. Leave it OUT of the inline set so its standalone
      // constraint action (which appends NOT VALID correctly) runs instead.
      const alsoProduces: StableId[] = [];
      for (const child of view.childrenOf(fact.id)) {
        if (child.id.kind !== "constraint") continue;
        if (!p(child, "validated")) continue;
        sql += ` CONSTRAINT ${qid((child.id as { name: string }).name)} ${str(p(child, "def"))}`;
        alsoProduces.push(child.id);
      }
      return [alsoProduces.length > 0 ? { sql, alsoProduces } : { sql }];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP DOMAIN ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER DOMAIN ${rel(id.schema, id.name)}`;
    },
    attributes: {
      default: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql:
              to == null
                ? `ALTER DOMAIN ${rel(id.schema, id.name)} DROP DEFAULT`
                : `ALTER DOMAIN ${rel(id.schema, id.name)} SET DEFAULT ${str(to)}`,
          };
        },
      },
      notNull: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER DOMAIN ${rel(id.schema, id.name)} ${to ? "SET" : "DROP"} NOT NULL`,
          };
        },
      },
      baseType: "replace",
      collation: "replace",
    },
  },

  type: {
    weight: 7,
    cascadesToChildren: true,
    defaclObjtype: "T", // ALTER DEFAULT PRIVILEGES … ON TYPES
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TYPE ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view, _params, sourceView) => {
      const id = fact.id as { schema: string; name: string };
      const relName = rel(id.schema, id.name);
      const variant = str(p(fact, "variant"));
      let sql: string;
      const alsoProduces: StableId[] = [];
      if (variant === "enum") {
        const values = (p(fact, "values") as string[]).map((v) => lit(v));
        sql = `CREATE TYPE ${relName} AS ENUM (${values.join(", ")})`;
      } else if (variant === "composite") {
        // attributes are sub-facts (granularity is one): inline them on the
        // fresh CREATE (delta-set, like partitioned-table columns) and
        // register them as produced so their standalone creates are skipped
        // Attribute ORDER is row-layout state: render in declared position
        // (`_position`, captured at extract time), NOT the encoded-id (name)
        // order childrenOf() yields — else composite columns silently reorder.
        // Fall back to the incoming (name) order when `_position` is absent
        // (legacy fact bases / snapshots) so the sort stays stable and total.
        const attrFacts = view
          .childrenOf(fact.id)
          .filter((c) => c.id.kind === "typeAttribute");
        const positioned = attrFacts.every((a) => p(a, "_position") != null);
        if (positioned) {
          attrFacts.sort(
            (a, b) => Number(p(a, "_position")) - Number(p(b, "_position")),
          );
        }
        const attrs = attrFacts.map((a) => typeAttributeClause(a));
        for (const a of attrFacts) alsoProduces.push(a.id);
        sql = `CREATE TYPE ${relName} AS (${attrs.join(", ")})`;
      } else {
        // GUARD (range variant): every range attribute is "replace", so any
        // change drops and recreates the type. A table column is NOT a
        // rebuildable kind, so if a SURVIVING user column depends on this range
        // type PostgreSQL rejects the DROP at apply ("cannot drop type … other
        // objects depend on it"). Fail loud at plan time — mirrors the in-use
        // composite ALTER ATTRIBUTE guard below. Only a REPLACE (the type is
        // present in the source) can hit this; a fresh create brings its
        // columns with it. Full in-place range column migration is tracked
        // separately.
        if (sourceView?.get(fact.id) !== undefined) {
          const inUse = compositeUserColumns(view, fact.id).filter(
            (colId) => sourceView.get(colId) !== undefined,
          );
          if (inUse.length > 0) {
            const cols = inUse
              .map((c) => {
                const col = c as {
                  schema: string;
                  table: string;
                  name: string;
                };
                return `${rel(col.schema, col.table)}.${qid(col.name)}`;
              })
              .join(", ");
            throw new Error(
              `range type ${relName}: cannot replace an in-use range type — column(s) ${cols} depend on it, and PostgreSQL forbids dropping a type while a column uses it. Replacing an in-use range type is not supported yet; drop the using column(s), or recreate the type, first.`,
            );
          }
        }
        const parts = [`SUBTYPE = ${str(p(fact, "subtype"))}`];
        const opclass = p(fact, "subtypeOpclass");
        if (opclass != null) parts.push(`SUBTYPE_OPCLASS = ${str(opclass)}`);
        const collation = p(fact, "collation");
        if (collation != null) parts.push(`COLLATION = ${str(collation)}`);
        const diff = p(fact, "subtypeDiff");
        if (diff != null) parts.push(`SUBTYPE_DIFF = ${str(diff)}`);
        const multirange = p(fact, "multirangeTypeName");
        if (multirange != null)
          parts.push(`MULTIRANGE_TYPE_NAME = ${str(multirange)}`);
        sql = `CREATE TYPE ${relName} AS RANGE (${parts.join(", ")})`;
      }
      return [
        {
          sql,
          ...(alsoProduces.length > 0 ? { alsoProduces } : {}),
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP TYPE ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TYPE ${rel(id.schema, id.name)}`;
    },
    attributes: {
      values: {
        alter: (fact, from, to, view, sourceView) => {
          const id = fact.id as { schema: string; name: string };
          const relName = rel(id.schema, id.name);
          const oldValues = (from as string[] | null) ?? [];
          const newValues = (to as string[] | null) ?? [];
          if (isSubsequence(oldValues, newValues)) {
            // pure growth: each missing value becomes ADD VALUE BEFORE/AFTER
            const specs: ActionSpec[] = [];
            let oldIdx = 0;
            for (let j = 0; j < newValues.length; j++) {
              const value = newValues[j] as string;
              if (oldIdx < oldValues.length && value === oldValues[oldIdx]) {
                oldIdx++;
                continue;
              }
              const anchor =
                oldIdx < oldValues.length
                  ? `BEFORE ${lit(oldValues[oldIdx] as string)}`
                  : j > 0
                    ? `AFTER ${lit(newValues[j - 1] as string)}`
                    : oldValues.length > 0
                      ? `BEFORE ${lit(oldValues[0] as string)}`
                      : "";
              specs.push({
                sql: `ALTER TYPE ${relName} ADD VALUE ${lit(value)}${anchor ? ` ${anchor}` : ""}`,
                // the new value is unusable before COMMIT: the executor
                // must place a segment boundary before any consumer (§3.8)
                transactionality: "commitBoundaryAfter",
              });
            }
            return specs;
          }
          // removal/reorder: rename aside, create the desired value set, walk
          // every column of this type through a text cast, drop the old type.
          // rebuildsDependents has already forced views/defaults/routines
          // that reference the type out of the way.
          // a deterministic temp name that cannot collide with an existing
          // type in the schema (bump a counter past any occupant)
          const taken = (n: string): boolean =>
            view.get({
              kind: "type",
              schema: id.schema,
              name: n,
            } as StableId) !== undefined ||
            sourceView.get({
              kind: "type",
              schema: id.schema,
              name: n,
            } as StableId) !== undefined;
          let tmp = `${id.name}__pgdelta_replaced`;
          for (let n = 2; taken(tmp); n++)
            tmp = `${id.name}__pgdelta_replaced_${n}`;
          const enumKey = encodeId(fact.id);
          const specs: ActionSpec[] = [
            { sql: `ALTER TYPE ${relName} RENAME TO ${qid(tmp)}` },
            {
              sql: `CREATE TYPE ${relName} AS ENUM (${newValues.map((v) => lit(v)).join(", ")})`,
            },
          ];
          const dependentColumns = view.edges
            .filter(
              (e) =>
                e.from.kind === "column" &&
                encodeId(e.to) === enumKey &&
                view.get(e.from) !== undefined &&
                // a column that exists only in the DESIRED state is being
                // created by this same plan (already with the new type) —
                // there is nothing to migrate
                sourceView.get(e.from) !== undefined,
            )
            .map(
              (e) =>
                e.from as {
                  kind: "column";
                  schema: string;
                  table: string;
                  name: string;
                },
            )
            .sort((a, b) =>
              `${a.schema}.${a.table}.${a.name}` <
              `${b.schema}.${b.table}.${b.name}`
                ? -1
                : 1,
            );
          for (const col of dependentColumns) {
            specs.push({
              sql: `ALTER TABLE ${rel(col.schema, col.table)} ALTER COLUMN ${qid(col.name)} TYPE ${relName} USING ${qid(col.name)}::text::${relName}`,
              // reference the rewritten column so the proof's rewrite
              // attribution maps this action to its table (the action's
              // primary subject is the type, not the table it rewrites)
              consumes: [col],
              dataLoss: "destructive",
              rewriteRisk: true,
            });
          }
          specs.push({ sql: `DROP TYPE ${rel(id.schema, tmp)}` });
          return specs;
        },
        rebuildsDependents: (from, to) =>
          !isSubsequence(
            (from as string[] | null) ?? [],
            (to as string[] | null) ?? [],
          ),
      },
      subtype: "replace",
      subtypeOpclass: "replace",
      subtypeDiff: "replace",
      multirangeTypeName: "replace",
      collation: "replace",
      variant: "replace",
    },
  },

  // composite-type attributes as sub-entity facts (granularity is one).
  // On a fresh type they inline into CREATE TYPE (delta-set, see the type
  // rule). On an existing type: ADD / DROP / RENAME ATTRIBUTE … CASCADE all
  // work even while the type is used in table columns and preserve the
  // stored data (verified). ALTER ATTRIBUTE … TYPE is the lone exception —
  // PostgreSQL forbids it while a column uses the type (CASCADE only reaches
  // typed tables, not columns), so it is supported only for unused
  // composites and fails loudly otherwise.
  typeAttribute: {
    weight: 7,
    create: (fact) => {
      const id = fact.id as { schema: string; type: string; name: string };
      return [
        {
          sql: `ALTER TYPE ${rel(id.schema, id.type)} ADD ATTRIBUTE ${typeAttributeClause(fact)} CASCADE`,
          consumes: [{ kind: "type", schema: id.schema, name: id.type }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; type: string; name: string };
      return {
        sql: `ALTER TYPE ${rel(id.schema, id.type)} DROP ATTRIBUTE ${qid(id.name)} CASCADE`,
      };
    },
    rename: (fact, to) => {
      const id = fact.id as { schema: string; type: string; name: string };
      return {
        sql: `ALTER TYPE ${rel(id.schema, id.type)} RENAME ATTRIBUTE ${qid(id.name)} TO ${qid((to as { name: string }).name)} CASCADE`,
      };
    },
    attributes: {
      type: {
        alter: (fact, _from, to, view) => {
          const id = fact.id as { schema: string; type: string; name: string };
          const typeId: StableId = {
            kind: "type",
            schema: id.schema,
            name: id.type,
          };
          if (compositeUserColumns(view, typeId).length > 0) {
            throw new Error(
              `composite type ${rel(id.schema, id.type)}: cannot change attribute "${id.name}" type while the type is used by table columns — PostgreSQL forbids ALTER ATTRIBUTE … TYPE on an in-use composite. Drop the using columns, or recreate the type, first.`,
            );
          }
          return {
            sql: `ALTER TYPE ${rel(id.schema, id.type)} ALTER ATTRIBUTE ${qid(id.name)} TYPE ${str(to)} CASCADE`,
          };
        },
      },
      // a collation-only change has no in-place form; replace the attribute
      collation: "replace",
    },
  },

  collation: {
    weight: 7,
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      const provider = str(p(fact, "provider"));
      const parts: string[] = [];
      if (provider === "i") {
        parts.push(`PROVIDER = icu`, `LOCALE = ${lit(str(p(fact, "locale")))}`);
        if (!p(fact, "deterministic")) parts.push(`DETERMINISTIC = false`);
      } else if (provider === "b") {
        parts.push(
          `PROVIDER = builtin`,
          `LOCALE = ${lit(str(p(fact, "locale")))}`,
        );
      } else {
        parts.push(
          `LC_COLLATE = ${lit(str(p(fact, "lcCollate")))}`,
          `LC_CTYPE = ${lit(str(p(fact, "lcCtype")))}`,
        );
      }
      return [
        {
          sql: `CREATE COLLATION ${rel(id.schema, id.name)} (${parts.join(", ")})`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP COLLATION ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER COLLATION ${rel(id.schema, id.name)}`;
    },
    attributes: {
      provider: "replace",
      deterministic: "replace",
      locale: "replace",
      lcCollate: "replace",
      lcCtype: "replace",
    },
  },
};
