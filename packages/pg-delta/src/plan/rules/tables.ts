/** Rule definitions for tables and their column / default sub-objects. */
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { qid, rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import {
  columnClause,
  columnRef,
  dependencyConsumes,
  identityGeneration,
  identityOptionAlterSpecs,
  identityOptions,
  identityOptionsClause,
  identitySequenceId,
  identitySequenceNameClause,
  p,
  reloptionsAlterSpecs,
  renameRule,
  replicaIdentitySpec,
  str,
} from "./helpers.ts";

export const tableRules: Record<string, KindRules> = {
  table: {
    weight: 4,
    cascadesToChildren: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TABLE ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view) => {
      const id = fact.id as { schema: string; name: string };
      const relName = rel(id.schema, id.name);
      const persistence = str(p(fact, "persistence"));
      const unlogged = persistence === "u" ? "UNLOGGED " : "";
      const bound = p(fact, "partitionBound");
      const partKey = p(fact, "partitionKey");
      const parentT = p(fact, "parentTable") as {
        schema: string;
        name: string;
      } | null;

      let createSql: string;
      const consumes: StableId[] = [];
      const alsoProduces: StableId[] = [];
      if (bound != null && parentT != null) {
        // a partition: columns are inherited, the bound carries the shape
        createSql = `CREATE ${unlogged}TABLE ${relName} PARTITION OF ${rel(parentT.schema, parentT.name)} ${str(bound)}`;
        // a partition may itself be partitioned (multi-level partitioning): keep
        // its own PARTITION BY so sub-partitions can attach — otherwise the
        // middle layer is created as a plain table and its leaves fail to attach.
        if (partKey != null) createSql += ` PARTITION BY ${str(partKey)}`;
        consumes.push({
          kind: "table",
          schema: parentT.schema,
          name: parentT.name,
        });
      } else {
        // partitioned parents must inline their columns: the partition key
        // references them, so decomposed ADD COLUMN cannot work (§3.4
        // delta-set inlining). The statement produces the column facts too.
        let cols = "";
        if (partKey != null) {
          const colFacts = view
            .childrenOf(fact.id)
            .filter((c) => c.id.kind === "column");
          // Column ORDER is row-layout state: render in declared position
          // (`_position` = pg_attribute.attnum, captured at extract time), NOT
          // the encoded-id (name) order childrenOf() yields. Fall back to the
          // incoming order when `_position` is absent (legacy fact bases) so the
          // sort stays stable and total. Mirrors the composite CREATE TYPE path
          // (plan/rules/types.ts). The bare foldable path is handled separately:
          // its columns arrive as ADD COLUMN folds, ordered by the tie-break in
          // plan/phases/action-graph.ts.
          if (colFacts.every((c) => p(c, "_position") != null)) {
            colFacts.sort(
              (a, b) => Number(p(a, "_position")) - Number(p(b, "_position")),
            );
          }
          cols = colFacts.map(columnClause).join(", ");
          for (const c of colFacts) alsoProduces.push(c.id);
        }
        createSql = `CREATE ${unlogged}TABLE ${relName} (${cols})`;
        if (parentT != null) {
          createSql += ` INHERITS (${rel(parentT.schema, parentT.name)})`;
          consumes.push({
            kind: "table",
            schema: parentT.schema,
            name: parentT.name,
          });
        }
        if (partKey != null) createSql += ` PARTITION BY ${str(partKey)}`;
      }

      // only the bare shape (no partition machinery, no INHERITS suffix)
      // can absorb folded column clauses without SQL surgery ambiguity
      const foldable = bound == null && partKey == null && parentT == null;
      const specs: ActionSpec[] = [
        {
          sql: createSql,
          ...(consumes.length > 0 ? { consumes } : {}),
          alsoProduces,
          ...(foldable ? { acceptsColumnFolds: true } : {}),
        },
      ];
      if (p(fact, "rowSecurity")) {
        specs.push({ sql: `ALTER TABLE ${relName} ENABLE ROW LEVEL SECURITY` });
      }
      if (p(fact, "forceRowSecurity")) {
        specs.push({ sql: `ALTER TABLE ${relName} FORCE ROW LEVEL SECURITY` });
      }
      const replident = p(fact, "replicaIdentity");
      if (replident != null && replident !== "d") {
        specs.push(replicaIdentitySpec(fact, view));
      }
      // storage reloptions (fillfactor, autovacuum_*, …) as a SET follow-up,
      // keeping them out of the partition/INHERITS/PARTITION BY create grammar
      const reloptions = p(fact, "reloptions") as string[] | null;
      if (reloptions != null && reloptions.length > 0) {
        specs.push({
          sql: `ALTER TABLE ${relName} SET (${reloptions.join(", ")})`,
        });
      }
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return {
        sql: `DROP TABLE ${rel(id.schema, id.name)}`,
        dataLoss: "destructive",
      };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TABLE ${rel(id.schema, id.name)}`;
    },
    attributes: {
      persistence: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.name)} SET ${str(to) === "u" ? "UNLOGGED" : "LOGGED"}`,
            rewriteRisk: true,
          };
        },
      },
      rowSecurity: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.name)} ${to ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY`,
          };
        },
      },
      forceRowSecurity: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.name)} ${to ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`,
          };
        },
      },
      replicaIdentity: {
        alter: (fact, _from, _to, view) => replicaIdentitySpec(fact, view),
      },
      replicaIdentityIndex: {
        alter: (fact, _from, _to, view) => replicaIdentitySpec(fact, view),
      },
      reloptions: {
        alter: (fact, from, to) => {
          const id = fact.id as { schema: string; name: string };
          return reloptionsAlterSpecs(
            `ALTER TABLE ${rel(id.schema, id.name)}`,
            from,
            to,
          );
        },
      },
      partitionKey: "replace",
      partitionBound: "replace",
      parentTable: "replace",
    },
  },

  column: {
    weight: 5,
    cascadesToChildren: true,
    rename: (fact, to) => {
      const { schema, table, column } = columnRef(fact);
      return {
        sql: `ALTER TABLE ${rel(schema, table)} RENAME COLUMN ${qid(column)} TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact, view) => {
      const { schema, table, column } = columnRef(fact);
      // delta-set inlining (§3.4): a column arriving WITH a default must
      // carry it inline — ADD COLUMN … NOT NULL fails on populated tables
      // otherwise. The statement then produces the default fact too.
      const defaultChild = view
        .childrenOf(fact.id)
        .find((c) => c.id.kind === "default" && c.id.name === column);
      let clause = columnClause(fact);
      const alsoProduces: StableId[] = [];
      if (defaultChild) {
        clause += ` DEFAULT ${str(defaultChild.payload["expr"])}`;
        alsoProduces.push(defaultChild.id);
      }
      // ADD COLUMN rewrites the table when it materializes a value for every
      // row: a STORED generated column always, or an inline DEFAULT whose
      // expression may be volatile (nextval, now, …). We cannot tell a
      // constant default from a volatile one without parsing (guardrail 2),
      // so any inline default conservatively declares rewriteRisk — over-
      // declaring is safe (the proof only fails on UNDER-declared rewrites).
      const rewrites =
        fact.payload["generatedExpr"] != null || defaultChild !== undefined;
      const spec: ActionSpec = {
        sql: `ALTER TABLE ${rel(schema, table)} ADD COLUMN ${clause}`,
        alsoProduces,
        ...(rewrites ? { rewriteRisk: true } : {}),
      };
      if (fact.parent !== undefined && fact.parent.kind === "table") {
        // Generated columns reference other columns in their expression; folding
        // them into an empty CREATE TABLE before those columns are present emits
        // invalid SQL (dbdev package_upgrades.from_version_struct roundtrip).
        if (fact.payload["generatedExpr"] == null) {
          spec.compaction = { foldInto: fact.parent, clause };
        }
      }
      return [spec];
    },
    drop: (fact) => {
      const { schema, table, column } = columnRef(fact);
      return {
        sql: `ALTER TABLE ${rel(schema, table)} DROP COLUMN ${qid(column)}`,
        dataLoss: "destructive",
      };
    },
    attributes: {
      type: {
        // delta-set shape: defaults can't be cast through a type change, so
        // the change is sandwiched DROP DEFAULT → TYPE … USING → SET DEFAULT.
        // Identity and generated columns take neither bookend (they can't hold a
        // default and PostgreSQL rejects the statements outright) — see below.
        alter: (fact, _from, to, view, sourceView) => {
          const { schema, table, column } = columnRef(fact);
          const target = `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)}`;
          // `fact` is the DESIRED-side column; the statements below run BEFORE
          // the type change, so anything conditional on the column's shape must
          // read the SOURCE side (identity may be added/dropped in the same
          // plan, by a delta the graph orders independently).
          const sourceColumn = sourceView.get(fact.id) ?? fact;
          const sourceIdentity = sourceColumn.payload["identity"] ?? null;
          const sourceGenerated = sourceColumn.payload["generatedExpr"] != null;
          // Foreign tables have no local storage, so PostgreSQL rejects the
          // USING cast clause ("<rel> is not a table", 42809) — it would force a
          // rewrite. The plain TYPE change is metadata-only and carries no
          // rewrite risk. (Regular tables keep the USING cast + rewriteRisk.)
          const isForeign = fact.parent?.kind === "foreignTable";
          // The retyped column depends on its NEW type via a column→type
          // pg_depend edge; consume it so this TYPE change is ordered AFTER a
          // same-plan CREATE of that type. Symmetrically, release the OLD type
          // (the source-side edge) so the change runs BEFORE a same-plan DROP of
          // it. Built-in types record no such edge (system-scoped endpoints are
          // dropped in extract), so a plain widening leaves both sets empty.
          const consumes = dependencyConsumes(view, fact.id);
          const releases = dependencyConsumes(sourceView, fact.id);
          // A generated column also rejects the USING clause ("cannot specify
          // USING when altering type of generated column") — PostgreSQL
          // recomputes the value from the generation expression. That still
          // rewrites the table, so rewriteRisk stays (unlike the foreign case).
          const usingCast =
            isForeign || sourceGenerated
              ? ""
              : ` USING ${qid(column)}::${str(to)}`;
          const typeSpec: ActionSpec = {
            sql: `${target} TYPE ${str(to)}${usingCast}`,
            ...(isForeign ? {} : { rewriteRisk: true }),
          };
          if (consumes.length > 0) typeSpec.consumes = consumes;
          if (releases.length > 0) typeSpec.releases = releases;
          const specs: ActionSpec[] = [];
          // DROP DEFAULT is a harmless no-op on a plain column that has none,
          // but PostgreSQL REJECTS it on an identity column ("… is an identity
          // column") or a generated column ("… is a generated column") whether
          // or not a default exists — and neither kind can carry one anyway.
          if (sourceIdentity == null && !sourceGenerated) {
            specs.push({ sql: `${target} DROP DEFAULT` });
          }
          specs.push(typeSpec);
          // An identity column's implicit sequence is typed after the column, so
          // widening moves the column type AND the identity bounds. Both deltas
          // land on the SAME fact with no edge between them and the differ emits
          // attributes alphabetically (`identity` < `type`), so `SET MAXVALUE`
          // would run while the sequence still has the old type ("MAXVALUE … is
          // out of range for sequence data type integer"). Fold the bounds in
          // AFTER the type change instead — `identity.alter` skips them when a
          // `type` delta is present. Correct in both directions: PostgreSQL
          // re-derives an at-type-max bound from the new type, and the explicit
          // SET then converges the exact desired values.
          const desiredIdentity = fact.payload["identity"] ?? null;
          if (sourceIdentity != null && desiredIdentity != null) {
            specs.push(
              ...identityOptionAlterSpecs(
                target,
                identityOptions(sourceIdentity),
                identityOptions(desiredIdentity),
              ),
            );
          }
          const desiredDefault = view
            .childrenOf(fact.id)
            .find((c) => c.id.kind === "default");
          if (desiredDefault) {
            specs.push({
              sql: `${target} SET DEFAULT ${str(desiredDefault.payload["expr"])}`,
            });
          }
          return specs;
        },
        // PostgreSQL rejects ALTER COLUMN … TYPE while a view, rule, or
        // policy references the column (0A000). Those dependents must be
        // dropped before the alter and recreated after; indexes and
        // constraints are NOT force-rebuilt (PG rebuilds them itself, and
        // dropping a PK with dependent FKs would cascade harmfully).
        rebuildsDependents: () => [
          "view",
          "materializedView",
          "rule",
          "policy",
        ],
      },
      notNull: {
        alter: (fact, _from, to) => {
          const { schema, table, column } = columnRef(fact);
          return {
            sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} ${to ? "SET" : "DROP"} NOT NULL`,
          };
        },
      },
      identity: {
        alter: (fact, from, to, _view, sourceView) => {
          const { schema, table, column } = columnRef(fact);
          const target = `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)}`;
          const fromSeq = identitySequenceId(from);
          const toSeq = identitySequenceId(to);
          if (to == null) {
            // the backing sequence dies with the identity; declaring it lets
            // the graph order a CREATE SEQUENCE of the same name afterwards
            return {
              sql: `${target} DROP IDENTITY`,
              ...(fromSeq == null ? {} : { alsoDestroys: [fromSeq] }),
            };
          }
          const phrase =
            identityGeneration(to) === "a"
              ? "GENERATED ALWAYS"
              : "GENERATED BY DEFAULT";
          const columnType = str(p(fact, "type"));
          if (from == null) {
            // ADD IDENTITY materializes the backing sequence; declaring it
            // orders this after a DROP SEQUENCE freeing the name. Non-default
            // sequence parameters ride along inline.
            return {
              sql: `${target} ADD ${phrase} AS IDENTITY${identityOptionsClause(identityOptions(to), columnType, identitySequenceNameClause(to, { schema, table, column }))}`,
              ...(toSeq == null ? {} : { alsoProduces: [toSeq] }),
            };
          }
          const specs: ActionSpec[] = [];
          if (identityGeneration(from) !== identityGeneration(to)) {
            specs.push({ sql: `${target} SET ${phrase}` });
          }
          if (
            fromSeq != null &&
            toSeq != null &&
            encodeId(fromSeq) !== encodeId(toSeq)
          ) {
            const fromParts = fromSeq as { schema: string; name: string };
            const toParts = toSeq as { schema: string; name: string };
            specs.push({
              sql: `ALTER SEQUENCE ${rel(fromParts.schema, fromParts.name)} RENAME TO ${qid(toParts.name)}`,
              alsoDestroys: [fromSeq],
              alsoProduces: [toSeq],
            });
          }
          // a parameter-only change (START/INCREMENT/CACHE/MIN/MAX/CYCLE) is an
          // in-place ALTER COLUMN SET — no sequence rebuild.
          // A concurrent `type` delta on the same column owns these bounds: they
          // must run AFTER the type change (the backing sequence is retyped with
          // the column), and `type.alter` folds them in there. Emitting them here
          // too would run them first — while the sequence still has the old type.
          const sourceType = sourceView.get(fact.id)?.payload["type"];
          const retyped =
            sourceType !== undefined && sourceType !== p(fact, "type");
          if (!retyped) {
            specs.push(
              ...identityOptionAlterSpecs(
                target,
                identityOptions(from),
                identityOptions(to),
              ),
            );
          }
          return specs;
        },
      },
      collation: "replace",
      generatedExpr: "replace",
    },
  },

  default: {
    weight: 6,
    cascadesToChildren: true,
    rebuildable: true,
    create: (fact) => {
      const { schema, table, column } = columnRef(fact);
      return [
        {
          sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} SET DEFAULT ${str(p(fact, "expr"))}`,
        },
      ];
    },
    drop: (fact) => {
      const { schema, table, column } = columnRef(fact);
      return {
        sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} DROP DEFAULT`,
      };
    },
    attributes: {
      expr: {
        alter: (fact, _from, to) => {
          const { schema, table, column } = columnRef(fact);
          return {
            sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} SET DEFAULT ${str(to)}`,
          };
        },
      },
    },
  },
};
