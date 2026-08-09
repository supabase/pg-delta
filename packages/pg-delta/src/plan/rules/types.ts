/** Rule definitions for domains, user-defined types (enum / composite / range),
 *  composite-type attributes, and collations. */
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { lit, qid, rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import {
  byteLength,
  clipToByteLength,
  compositeUserColumns,
  dependencyConsumes,
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
          const enumKey = encodeId(fact.id);
          // GUARD (non-column dependents): the rebuild migrates only COLUMN
          // dependents. A DOMAIN over the enum, a COMPOSITE type with an
          // attribute of the enum, or a RANGE over the enum is NOT a rebuildable
          // kind, so a SURVIVING one stays bound to the renamed old type and the
          // final DROP TYPE fails at apply ("cannot drop type … other objects
          // depend on it"). Fail loud at plan time — mirrors the in-use domain /
          // range / composite ALTER ATTRIBUTE guards. Only dependents present on
          // BOTH sides (view = desired, sourceView = target DB) can hit this;
          // one this plan drops or creates is not a blocker. Full migration of
          // non-column dependents is tracked separately.
          const seenDependents = new Set<string>();
          const nonColumnDependents = view.edges
            .filter(
              (e) =>
                encodeId(e.to) === enumKey &&
                (e.from.kind === "domain" || e.from.kind === "type") &&
                encodeId(e.from) !== enumKey &&
                view.get(e.from) !== undefined &&
                sourceView.get(e.from) !== undefined,
            )
            .map((e) => e.from)
            .filter((depId) => {
              const key = encodeId(depId);
              if (seenDependents.has(key)) return false;
              seenDependents.add(key);
              return true;
            })
            .sort((a, b) => (encodeId(a) < encodeId(b) ? -1 : 1));
          if (nonColumnDependents.length > 0) {
            const deps = nonColumnDependents
              .map((depId) => {
                const d = depId as {
                  kind: string;
                  schema: string;
                  name: string;
                };
                const keyword = d.kind === "domain" ? "DOMAIN" : "TYPE";
                return `${keyword} ${rel(d.schema, d.name)}`;
              })
              .join(", ");
            throw new Error(
              `enum ${relName}: cannot remove or reorder values while non-column object(s) depend on it — ${deps}. The rebuild drops the old enum, which those objects still reference, and PostgreSQL forbids dropping a type in use. Migrating a DOMAIN / COMPOSITE / RANGE that uses an enum across a value-set change is not supported yet; drop the dependent object(s), or recreate them, first.`,
            );
          }
          // A deterministic temp name for the old enum, RENAMEd aside before the
          // new value set is created. It must collide with NO occupant of the
          // type namespace (pg_type) visible in the fact base — not only managed
          // enum/composite/range `type` facts, but DOMAINS and the implicit row
          // type every relation (table / view / matview / foreign table /
          // sequence) registers in pg_type under its own name. Checking only
          // `type` facts let a table (or domain) named `<enum>__pgdelta_replaced`
          // slip through, so the initial `ALTER TYPE … RENAME TO` failed at apply
          // with "type … already exists".
          const OCCUPANT_KINDS = [
            "type",
            "domain",
            "table",
            "view",
            "materializedView",
            "foreignTable",
            "sequence",
          ] as const;
          const taken = (n: string): boolean =>
            OCCUPANT_KINDS.some(
              (kind) =>
                view.get({ kind, schema: id.schema, name: n } as StableId) !==
                  undefined ||
                sourceView.get({
                  kind,
                  schema: id.schema,
                  name: n,
                } as StableId) !== undefined,
            );
          // Length-safe: PostgreSQL clips identifiers to NAMEDATALEN-1 (63)
          // BYTES, so a long enum name + suffix would be truncated by the server
          // and could land back on an occupied name (a 63-byte enum whose temp
          // truncates to the ORIGINAL name → RENAME to itself). Clip the base
          // ourselves so the whole identifier stays ≤ 63 bytes and is stored
          // verbatim; `taken` then guarantees uniqueness. Deterministic: same
          // enum name + same fact base → same temp name.
          const MAX_IDENT_BYTES = 63;
          const REPLACED_SUFFIX = "__pgdelta_replaced";
          const buildTmp = (n: number | null): string => {
            const numeric = n === null ? "" : `_${n}`;
            const budget =
              MAX_IDENT_BYTES -
              byteLength(REPLACED_SUFFIX) -
              byteLength(numeric);
            return `${clipToByteLength(id.name, budget)}${REPLACED_SUFFIX}${numeric}`;
          };
          let tmp = buildTmp(null);
          for (let n = 2; taken(tmp); n++) {
            if (n > 10_000) {
              throw new Error(
                `enum ${relName}: could not find a free temp name for the value-set rebuild after 10000 attempts — an extraordinary number of \`${REPLACED_SUFFIX}\`-suffixed occupants exist in schema "${id.schema}"`,
              );
            }
            tmp = buildTmp(n);
          }
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
            // The column's declared type (format_type() output, captured
            // verbatim at extract time — structured catalog data, not parsed
            // SQL) tells whether it is an ARRAY of this enum: format_type
            // renders an array type with a trailing `[]`. A scalar column
            // casts through `text`; an array column must cast through
            // `text[]` (element-wise) — `col::text` on an array has no
            // built-in cast to the scalar enum and either errors
            // ("invalid input value for enum ... {a,b}") or, worse, silently
            // narrows the column to scalar.
            const colFact = view.get(col);
            const colType =
              colFact !== undefined ? str(p(colFact, "type")) : "";
            const isArray = colType.endsWith("[]");
            const targetType = isArray ? `${relName}[]` : relName;
            const usingCast = isArray
              ? `${qid(col.name)}::text[]::${relName}[]`
              : `${qid(col.name)}::text::${relName}`;
            specs.push({
              sql: `ALTER TABLE ${rel(col.schema, col.table)} ALTER COLUMN ${qid(col.name)} TYPE ${targetType} USING ${usingCast}`,
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
      // Destructive: DROP ATTRIBUTE … CASCADE nulls the stored value of that
      // field across every row of every table whose column is of this
      // composite. A collation-only attribute change routes through the
      // attribute "replace" strategy (drop + recreate), which renders via THIS
      // drop rule too, so this one flag covers that path as well.
      return {
        sql: `ALTER TYPE ${rel(id.schema, id.type)} DROP ATTRIBUTE ${qid(id.name)} CASCADE`,
        dataLoss: "destructive",
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
        alter: (fact, _from, to, view, sourceView) => {
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
          // A composite attribute's type dependency is extracted onto the
          // enclosing `type` fact, not this `typeAttribute` child (see the
          // `comptype` CTE in extract/dependencies.ts). When the composite is
          // only being retyped (not dropped/created) its own actions never
          // fire, so — mirroring the ALTER COLUMN … TYPE fix in tables.ts —
          // release the OLD referenced types (source side) so this alter runs
          // BEFORE their same-plan DROP, and consume the NEW ones (target side)
          // so it runs AFTER their same-plan CREATE. The edges are keyed to the
          // parent type fact; over-scoping to a sibling attribute's still-used
          // type is harmless (nothing drops it → no ordering edge is added).
          const consumes = dependencyConsumes(view, typeId);
          const releases = dependencyConsumes(sourceView, typeId);
          const spec: ActionSpec = {
            sql: `ALTER TYPE ${rel(id.schema, id.type)} ALTER ATTRIBUTE ${qid(id.name)} TYPE ${str(to)} CASCADE`,
          };
          if (consumes.length > 0) spec.consumes = consumes;
          if (releases.length > 0) spec.releases = releases;
          return spec;
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
