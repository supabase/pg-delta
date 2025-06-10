import type {
  A_Const,
  AlterOwnerStmt,
  AlterTableCmd,
  BitString,
  BoolExpr,
  ColumnDef,
  CompositeTypeStmt,
  Constraint,
  CreateEnumStmt,
  CreateExtensionStmt,
  CreateSchemaStmt,
  Float,
  IntList,
  JsonArrayConstructor,
  JsonFuncExpr,
  JsonObjectConstructor,
  Node,
  ObjectType,
  OidList,
  Param,
  SubLink,
} from "@supabase/pg-parser/17/types";

// Basic type guards
export const isString = (
  node: Node | undefined,
): node is { String: { sval: string } } => {
  return Boolean(node && "String" in node);
};

export const isInteger = (
  node: Node | undefined,
): node is { Integer: { ival: number } } => {
  return Boolean(node && "Integer" in node);
};

export const isFloat = (node: Node | undefined): node is { Float: Float } => {
  return Boolean(node && "Float" in node);
};

export const isBoolean = (
  node: Node | undefined,
): node is { Boolean: { boolval: boolean } } => {
  return Boolean(node && "Boolean" in node);
};

export const isBitString = (
  node: Node | undefined,
): node is { BitString: BitString } => {
  return Boolean(node && "BitString" in node);
};

export const isList = (
  node: Node | undefined,
): node is { List: { items: Node[] } } => {
  return Boolean(node && "List" in node);
};

export const isOidList = (
  node: Node | undefined,
): node is { OidList: OidList } => {
  return Boolean(node && "OidList" in node);
};

export const isIntList = (
  node: Node | undefined,
): node is { IntList: IntList } => {
  return Boolean(node && "IntList" in node);
};

// Statement type guards
export const isCreateSchemaStmt = (
  node: Node | undefined,
): node is { CreateSchemaStmt: CreateSchemaStmt } => {
  return Boolean(node && "CreateSchemaStmt" in node);
};

export const isAlterOwnerStmt = (
  node: Node | undefined,
): node is { AlterOwnerStmt: AlterOwnerStmt } => {
  return Boolean(node && "AlterOwnerStmt" in node);
};

export const isCreateExtensionStmt = (
  node: Node | undefined,
): node is { CreateExtensionStmt: CreateExtensionStmt } => {
  return Boolean(node && "CreateExtensionStmt" in node);
};

export const isCommentStmt = (
  node: Node | undefined,
): node is { CommentStmt: { objtype: ObjectType } } => {
  return Boolean(node && "CommentStmt" in node);
};

export const isCreateEnumStmt = (
  node: Node | undefined,
): node is { CreateEnumStmt: CreateEnumStmt } => {
  return Boolean(node && "CreateEnumStmt" in node);
};

export const isCompositeTypeStmt = (
  node: Node | undefined,
): node is { CompositeTypeStmt: CompositeTypeStmt } => {
  return Boolean(node && "CompositeTypeStmt" in node);
};

export const isCreateFunctionStmt = (
  node: Node | undefined,
): node is { CreateFunctionStmt: { funcname: Node[] } } => {
  return Boolean(node && "CreateFunctionStmt" in node);
};

export const isCreateStmt = (
  node: Node | undefined,
): node is { CreateStmt: { relation: { relname: string } } } => {
  return Boolean(node && "CreateStmt" in node);
};

export const isAlterTableStmt = (
  node: Node | undefined,
): node is { AlterTableStmt: { relation: { relname: string } } } => {
  return Boolean(node && "AlterTableStmt" in node);
};

export const isCreateSeqStmt = (
  node: Node | undefined,
): node is { CreateSeqStmt: { sequence: { relname: string } } } => {
  return Boolean(node && "CreateSeqStmt" in node);
};

export const isAlterSeqStmt = (
  node: Node | undefined,
): node is { AlterSeqStmt: { sequence: { relname: string } } } => {
  return Boolean(node && "AlterSeqStmt" in node);
};

export const isIndexStmt = (
  node: Node | undefined,
): node is { IndexStmt: { idxname: string } } => {
  return Boolean(node && "IndexStmt" in node);
};

export const isCreateTrigStmt = (
  node: Node | undefined,
): node is { CreateTrigStmt: { trigname: string } } => {
  return Boolean(node && "CreateTrigStmt" in node);
};

export const isCreatePublicationStmt = (
  node: Node | undefined,
): node is { CreatePublicationStmt: { pubname: string } } => {
  return Boolean(node && "CreatePublicationStmt" in node);
};

export const isGrantStmt = (
  node: Node | undefined,
): node is { GrantStmt: { is_grant: boolean } } => {
  return Boolean(node && "GrantStmt" in node);
};

export const isAlterDefaultPrivilegesStmt = (
  node: Node | undefined,
): node is {
  AlterDefaultPrivilegesStmt: { action: { is_grant: boolean } };
} => {
  return Boolean(node && "AlterDefaultPrivilegesStmt" in node);
};

export const isCreateEventTrigStmt = (
  node: Node | undefined,
): node is { CreateEventTrigStmt: { trigname: string } } => {
  return Boolean(node && "CreateEventTrigStmt" in node);
};

// Expression type guards
export const isA_Const = (
  node: Node | undefined,
): node is { A_Const: A_Const } => {
  return Boolean(node && "A_Const" in node);
};

export const isAlias = (
  node: Node | undefined,
): node is { Alias: { aliasname: string } } => {
  return Boolean(node && "Alias" in node);
};

export const isRangeVar = (
  node: Node | undefined,
): node is { RangeVar: { relname: string } } => {
  return Boolean(node && "RangeVar" in node);
};

export const isVar = (
  node: Node | undefined,
): node is { Var: { varno: number } } => {
  return Boolean(node && "Var" in node);
};

export const isParam = (node: Node | undefined): node is { Param: Param } => {
  return Boolean(node && "Param" in node);
};

export const isAggref = (
  node: Node | undefined,
): node is { Aggref: { aggfnoid: number } } => {
  return Boolean(node && "Aggref" in node);
};

export const isFuncExpr = (
  node: Node | undefined,
): node is { FuncExpr: { funcid: number } } => {
  return Boolean(node && "FuncExpr" in node);
};

export const isOpExpr = (
  node: Node | undefined,
): node is { OpExpr: { opno: number } } => {
  return Boolean(node && "OpExpr" in node);
};

export const isBoolExpr = (
  node: Node | undefined,
): node is { BoolExpr: BoolExpr } => {
  return Boolean(node && "BoolExpr" in node);
};

export const isSubLink = (
  node: Node | undefined,
): node is { SubLink: SubLink } => {
  return Boolean(node && "SubLink" in node);
};

export const isCaseExpr = (
  node: Node | undefined,
): node is { CaseExpr: { arg: Node } } => {
  return Boolean(node && "CaseExpr" in node);
};

export const isArrayExpr = (
  node: Node | undefined,
): node is { ArrayExpr: { elements: Node[] } } => {
  return Boolean(node && "ArrayExpr" in node);
};

export const isRowExpr = (
  node: Node | undefined,
): node is { RowExpr: { args: Node[] } } => {
  return Boolean(node && "RowExpr" in node);
};

// Query type guards
export const isSelectStmt = (
  node: Node | undefined,
): node is { SelectStmt: { targetList: Node[] } } => {
  return Boolean(node && "SelectStmt" in node);
};

export const isInsertStmt = (
  node: Node | undefined,
): node is { InsertStmt: { relation: { relname: string } } } => {
  return Boolean(node && "InsertStmt" in node);
};

export const isUpdateStmt = (
  node: Node | undefined,
): node is { UpdateStmt: { relation: { relname: string } } } => {
  return Boolean(node && "UpdateStmt" in node);
};

export const isDeleteStmt = (
  node: Node | undefined,
): node is { DeleteStmt: { relation: { relname: string } } } => {
  return Boolean(node && "DeleteStmt" in node);
};

// Type definition guards
export const isTypeName = (
  node: Node | undefined,
): node is { TypeName: { names: Node[] } } => {
  return Boolean(node && "TypeName" in node);
};

export const isColumnDef = (
  node: Node | undefined,
): node is { ColumnDef: ColumnDef } => {
  return Boolean(node && "ColumnDef" in node);
};

export const isConstraint = (
  node: Node | undefined,
): node is { Constraint: Constraint } => {
  return Boolean(node && "Constraint" in node);
};

// JSON type guards
export const isJsonFuncExpr = (
  node: Node | undefined,
): node is { JsonFuncExpr: JsonFuncExpr } => {
  return Boolean(node && "JsonFuncExpr" in node);
};

export const isJsonObjectConstructor = (
  node: Node | undefined,
): node is { JsonObjectConstructor: JsonObjectConstructor } => {
  return Boolean(node && "JsonObjectConstructor" in node);
};

export const isJsonArrayConstructor = (
  node: Node | undefined,
): node is { JsonArrayConstructor: JsonArrayConstructor } => {
  return Boolean(node && "JsonArrayConstructor" in node);
};

export const isAlterTableCmd = (
  node: Node | undefined,
): node is { AlterTableCmd: AlterTableCmd } => {
  return Boolean(node && "AlterTableCmd" in node);
};
