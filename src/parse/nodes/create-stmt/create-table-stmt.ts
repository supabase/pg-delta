import type {
  ColumnDef,
  Constraint,
  CreateStmt,
  Node,
} from "@supabase/pg-parser/17/types";

type CreateTableStmt = CreateStmt & {
  relation: NonNullable<CreateStmt["relation"]>;
  oncommit: NonNullable<CreateStmt["oncommit"]>;
  tableElts: NonNullable<CreateStmt["tableElts"]>;
};

type CreatePermanentTableStmt = CreateTableStmt & {
  relation: CreateTableStmt["relation"] & {
    schemaname: string;
    relname: string;
    relpersistence: "p";
  };
};

export const isCreateTableStmt = (
  node: CreateStmt,
): node is CreateTableStmt => {
  return Boolean(node.oncommit && node.relation && node.tableElts);
};

const isCreatePermanentTableStmt = (
  node: CreateStmt,
): node is CreatePermanentTableStmt => {
  return isCreateTableStmt(node) && node.relation.relpersistence === "p";
};

const isColumnDef = (node: Node): node is { ColumnDef: ColumnDef } => {
  return "ColumnDef" in node;
};

const isConstraint = (node: Node): node is { Constraint: Constraint } => {
  return "Constraint" in node;
};

export function handleCreateTableStmt(node: CreateTableStmt) {
  if (isCreatePermanentTableStmt(node)) {
    return handleCreatePermanentTableStmt(node);
  } else {
    throw new Error(
      `Unhandled node type in create table stmt ${JSON.stringify(node)}`,
    );
  }
}

function handleCreatePermanentTableStmt(node: CreatePermanentTableStmt) {
  const schema = node.relation.schemaname;
  const name = node.relation.relname;
  const id = `${schema}.${name}`;
  const columns = node.tableElts
    .filter(isColumnDef)
    .map(({ ColumnDef }) => ColumnDef);
  const constraints = node.tableElts
    .filter(isConstraint)
    .map(({ Constraint }) => Constraint);
  const tableDefinition = {
    id,
    schema,
    name,
    columns,
    constraints,
  };
  return tableDefinition;
}
