/**
 * Foreign-key cycle breaking (pg_dump style).
 *
 * A mutual FK reference between two `CREATE TABLE` statements (or any FK
 * loop spanning several tables) is a real dependency cycle: neither table
 * can be created first with its FK declared inline. PostgreSQL's own
 * pg_dump handles this by creating the tables without the offending FK and
 * re-adding it afterwards via `ALTER TABLE ... ADD CONSTRAINT`.
 *
 * This module performs the same rewrite on the parsed statement set. Given
 * the cycle groups discovered by the topological sort, it:
 *
 * 1. Finds the `CREATE TABLE` statements participating in each cycle.
 * 2. Strips every FK constraint that points at *another* table in the same
 *    cycle (self-referential FKs are left inline — PostgreSQL accepts those
 *    within a single `CREATE TABLE`).
 * 3. Re-emits each stripped FK as a standalone `ALTER TABLE ... ADD
 *    CONSTRAINT` statement, preserving the original constraint definition
 *    (name, columns, `ON DELETE`/`ON UPDATE` actions, match type, etc.).
 *
 * The rewritten statement set is acyclic and applies cleanly in a single
 * forward pass. The constraint AST node is moved verbatim into the ALTER
 * command, so no FK option is lost; column-level FKs (which carry no
 * `fk_attrs` because the column is implicit) gain an explicit `fk_attrs`
 * entry naming the owning column.
 */

import { deparseSql } from "plpgsql-parser";
import type { ParsedStatement } from "../ingest/parse.ts";
import type { StatementId, StatementNode } from "../model/types.ts";
import { asRecord } from "../utils/ast.ts";

const DEFAULT_SCHEMA = "public";

const tableKeyFromRelation = (
  relation: Record<string, unknown> | undefined,
): string | undefined => {
  const relname =
    typeof relation?.relname === "string" ? relation.relname : undefined;
  if (!relname) {
    return undefined;
  }
  const schema =
    typeof relation?.schemaname === "string"
      ? relation.schemaname
      : DEFAULT_SCHEMA;
  return `${schema}.${relname}`;
};

const createStmtOf = (ast: unknown): Record<string, unknown> | undefined =>
  asRecord(asRecord(ast)?.CreateStmt);

const isForeignKeyConstraint = (
  constraint: Record<string, unknown> | undefined,
): boolean => constraint?.contype === "CONSTR_FOREIGN";

const referencedTableKey = (
  constraint: Record<string, unknown>,
): string | undefined => tableKeyFromRelation(asRecord(constraint.pktable));

const buildAddConstraintAlter = (
  relation: unknown,
  constraint: Record<string, unknown>,
): unknown => ({
  AlterTableStmt: {
    relation,
    objtype: "OBJECT_TABLE",
    cmds: [
      {
        AlterTableCmd: {
          subtype: "AT_AddConstraint",
          def: { Constraint: constraint },
        },
      },
    ],
  },
});

type StripResult = {
  /** Cloned CreateStmt AST with cross-cycle FK constraints removed. */
  createAst: unknown;
  /** ALTER TABLE ADD CONSTRAINT AST nodes for each deferred FK. */
  alterAsts: unknown[];
};

/**
 * Remove FK constraints pointing at other tables in `cycleTableKeys` from a
 * `CREATE TABLE` AST and return the deferred FKs as ALTER statements.
 * Returns null when there is nothing to defer.
 */
const stripCrossCycleForeignKeys = (
  ast: unknown,
  ownTableKey: string,
  cycleTableKeys: ReadonlySet<string>,
): StripResult | null => {
  const clonedAst = structuredClone(ast);
  const create = createStmtOf(clonedAst);
  const relation = create?.relation;
  if (!create || !Array.isArray(create.tableElts)) {
    return null;
  }

  const alterAsts: unknown[] = [];
  const keptElements: unknown[] = [];

  for (const element of create.tableElts) {
    const elementRecord = asRecord(element);

    // Table-level constraint, e.g. `CONSTRAINT fk FOREIGN KEY (a) REFERENCES ...`
    const tableConstraint = asRecord(elementRecord?.Constraint);
    if (isForeignKeyConstraint(tableConstraint) && tableConstraint) {
      const refKey = referencedTableKey(tableConstraint);
      if (refKey && refKey !== ownTableKey && cycleTableKeys.has(refKey)) {
        alterAsts.push(buildAddConstraintAlter(relation, tableConstraint));
        continue;
      }
    }

    // Column-level constraint, e.g. `col uuid REFERENCES other (id)`
    const columnDefinition = asRecord(elementRecord?.ColumnDef);
    if (columnDefinition && Array.isArray(columnDefinition.constraints)) {
      const columnName =
        typeof columnDefinition.colname === "string"
          ? columnDefinition.colname
          : undefined;
      const keptConstraints: unknown[] = [];
      for (const constraintItem of columnDefinition.constraints) {
        const constraint = asRecord(asRecord(constraintItem)?.Constraint);
        if (isForeignKeyConstraint(constraint) && constraint && columnName) {
          const refKey = referencedTableKey(constraint);
          if (refKey && refKey !== ownTableKey && cycleTableKeys.has(refKey)) {
            // A column-level FK omits fk_attrs (the column is implicit); make
            // it explicit so the standalone ALTER knows the referencing column.
            const tableLevelConstraint = {
              ...constraint,
              fk_attrs: [{ String: { sval: columnName } }],
            };
            alterAsts.push(
              buildAddConstraintAlter(relation, tableLevelConstraint),
            );
            continue;
          }
        }
        keptConstraints.push(constraintItem);
      }
      // Reassign so the column keeps its remaining constraints (type, NOT
      // NULL, DEFAULT, self-FK, ...) while shedding the deferred FK.
      columnDefinition.constraints =
        keptConstraints.length > 0 ? keptConstraints : undefined;
    }

    keptElements.push(element);
  }

  if (alterAsts.length === 0) {
    return null;
  }

  create.tableElts = keptElements;
  return { createAst: clonedAst, alterAsts };
};

/**
 * Break foreign-key dependency cycles by deferring cross-cycle FK
 * constraints into standalone `ALTER TABLE ... ADD CONSTRAINT` statements.
 *
 * @param statements - The full parsed statement set, in input order.
 * @param nodes - Statement nodes aligned 1:1 with `statements` (provides
 *   the classification used to pick `CREATE TABLE` cycle members).
 * @param cycleGroups - Cycle node-index groups from the topological sort.
 * @returns A rewritten statement set, or null if no FK could be deferred
 *   (e.g. the cycle is not made of inline table FKs).
 */
export const breakForeignKeyCycles = async (
  statements: readonly ParsedStatement[],
  nodes: readonly StatementNode[],
  cycleGroups: readonly number[][],
): Promise<ParsedStatement[] | null> => {
  // Map each cyclic CREATE TABLE statement index to its table key, grouped
  // by the cycle it belongs to. Only FKs between two tables in the same
  // cycle must be deferred.
  const tableKeyByIndex = new Map<number, string>();
  const cycleTableKeysByIndex = new Map<number, ReadonlySet<string>>();

  for (const group of cycleGroups) {
    const tableKeys = new Set<string>();
    const tableIndexes: number[] = [];
    for (const index of group) {
      if (nodes[index]?.statementClass !== "CREATE_TABLE") {
        continue;
      }
      const create = createStmtOf(statements[index]?.ast);
      const key = tableKeyFromRelation(asRecord(create?.relation));
      if (!key) {
        continue;
      }
      tableKeyByIndex.set(index, key);
      tableKeys.add(key);
      tableIndexes.push(index);
    }
    for (const index of tableIndexes) {
      cycleTableKeysByIndex.set(index, tableKeys);
    }
  }

  if (tableKeyByIndex.size === 0) {
    return null;
  }

  // Synthetic ALTER statements reuse the owning statement's file path with a
  // fresh, collision-free statementIndex appended after that file's originals.
  const nextIndexByFile = new Map<string, number>();
  for (const statement of statements) {
    const current = nextIndexByFile.get(statement.id.filePath) ?? 0;
    nextIndexByFile.set(
      statement.id.filePath,
      Math.max(current, statement.id.statementIndex + 1),
    );
  }
  const allocateSyntheticId = (owner: ParsedStatement): StatementId => {
    const filePath = owner.id.filePath;
    const statementIndex = nextIndexByFile.get(filePath) ?? 0;
    nextIndexByFile.set(filePath, statementIndex + 1);
    return {
      filePath,
      statementIndex,
      sourceOffset: owner.id.sourceOffset,
    };
  };

  const rewritten: ParsedStatement[] = [];
  const appendedAlters: ParsedStatement[] = [];
  let didDefer = false;

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    const ownTableKey = tableKeyByIndex.get(index);
    const cycleTableKeys = cycleTableKeysByIndex.get(index);

    if (!ownTableKey || !cycleTableKeys) {
      rewritten.push(statement);
      continue;
    }

    const stripped = stripCrossCycleForeignKeys(
      statement.ast,
      ownTableKey,
      cycleTableKeys,
    );
    if (!stripped) {
      rewritten.push(statement);
      continue;
    }

    didDefer = true;
    const createSql = await deparseSql(stripped.createAst as object);
    rewritten.push({
      ...statement,
      ast: stripped.createAst,
      sql: createSql.trimEnd().endsWith(";") ? createSql : `${createSql};`,
    });

    for (const alterAst of stripped.alterAsts) {
      const alterSql = await deparseSql(alterAst as object);
      appendedAlters.push({
        id: allocateSyntheticId(statement),
        ast: alterAst,
        sql: alterSql.trimEnd().endsWith(";") ? alterSql : `${alterSql};`,
        // ADD CONSTRAINT statements have no annotation hints of their own.
        annotations: {
          dependsOn: [],
          requires: [],
          provides: [],
        },
      });
    }
  }

  if (!didDefer) {
    return null;
  }

  return [...rewritten, ...appendedAlters];
};
