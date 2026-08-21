import type { PhaseTag } from "../model/types.ts";
import { asRecord } from "../utils/ast.ts";

export type StatementClass =
  | "CREATE_SCHEMA"
  | "CREATE_LANGUAGE"
  | "CREATE_EXTENSION"
  | "CREATE_FOREIGN_DATA_WRAPPER"
  | "CREATE_FOREIGN_SERVER"
  | "CREATE_ACCESS_METHOD"
  | "CREATE_TYPE"
  | "CREATE_ROLE"
  | "CREATE_PUBLICATION"
  | "ALTER_PUBLICATION"
  | "CREATE_SUBSCRIPTION"
  | "ALTER_SUBSCRIPTION"
  | "CREATE_DOMAIN"
  | "CREATE_COLLATION"
  | "CREATE_SEQUENCE"
  | "ALTER_SEQUENCE"
  | "CREATE_TABLE"
  | "ALTER_TABLE"
  | "CREATE_INDEX"
  | "CREATE_OPERATOR"
  | "CREATE_OPERATOR_CLASS"
  | "CREATE_OPERATOR_FAMILY"
  | "CREATE_FUNCTION"
  | "CREATE_PROCEDURE"
  | "CREATE_AGGREGATE"
  | "CREATE_VIEW"
  | "CREATE_MATERIALIZED_VIEW"
  | "CREATE_TRIGGER"
  | "CREATE_RULE"
  | "CREATE_EVENT_TRIGGER"
  | "CREATE_POLICY"
  | "GRANT"
  | "REVOKE"
  | "ALTER_DEFAULT_PRIVILEGES"
  | "SELECT"
  | "UPDATE"
  | "DO"
  | "VARIABLE_SET"
  | "COMMENT"
  | "ALTER_OWNER"
  | "UNKNOWN";

const CLASS_BY_AST_NODE: Record<string, StatementClass> = {
  AlterPublicationStmt: "ALTER_PUBLICATION",
  AlterTableStmt: "ALTER_TABLE",
  AlterOwnerStmt: "ALTER_OWNER",
  AlterDefaultPrivilegesStmt: "ALTER_DEFAULT_PRIVILEGES",
  AlterSeqStmt: "ALTER_SEQUENCE",
  AlterSubscriptionStmt: "ALTER_SUBSCRIPTION",
  CommentStmt: "COMMENT",
  CreateAmStmt: "CREATE_ACCESS_METHOD",
  CreatePLangStmt: "CREATE_LANGUAGE",
  CompositeTypeStmt: "CREATE_TYPE",
  CreateEnumStmt: "CREATE_TYPE",
  CreateDomainStmt: "CREATE_DOMAIN",
  CreateExtensionStmt: "CREATE_EXTENSION",
  CreateEventTrigStmt: "CREATE_EVENT_TRIGGER",
  CreateFdwStmt: "CREATE_FOREIGN_DATA_WRAPPER",
  CreateForeignServerStmt: "CREATE_FOREIGN_SERVER",
  CreateFunctionStmt: "CREATE_FUNCTION",
  CreateOpClassStmt: "CREATE_OPERATOR_CLASS",
  CreateOpFamilyStmt: "CREATE_OPERATOR_FAMILY",
  CreatePublicationStmt: "CREATE_PUBLICATION",
  CreateRoleStmt: "CREATE_ROLE",
  CreatePolicyStmt: "CREATE_POLICY",
  CreateRangeStmt: "CREATE_TYPE",
  CreateSchemaStmt: "CREATE_SCHEMA",
  CreateSeqStmt: "CREATE_SEQUENCE",
  CreateSubscriptionStmt: "CREATE_SUBSCRIPTION",
  CreateTableAsStmt: "CREATE_TABLE",
  CreateStmt: "CREATE_TABLE",
  CreateTrigStmt: "CREATE_TRIGGER",
  DefineStmt: "UNKNOWN",
  DoStmt: "DO",
  GrantStmt: "GRANT",
  IndexStmt: "CREATE_INDEX",
  RuleStmt: "CREATE_RULE",
  SelectStmt: "SELECT",
  UpdateStmt: "UPDATE",
  VariableSetStmt: "VARIABLE_SET",
  ViewStmt: "CREATE_VIEW",
};

export const classifyStatement = (ast: unknown): StatementClass => {
  if (!ast || typeof ast !== "object") {
    return "UNKNOWN";
  }

  const nodeName = Object.keys(ast)[0];
  if (!nodeName) {
    return "UNKNOWN";
  }

  const statementClass = CLASS_BY_AST_NODE[nodeName];
  if (!statementClass) {
    return "UNKNOWN";
  }

  if (nodeName === "CreateFunctionStmt") {
    const createFunctionStmt = (ast as Record<string, unknown>)
      .CreateFunctionStmt as Record<string, unknown> | undefined;
    const isProcedure = createFunctionStmt?.is_procedure === true;
    return isProcedure ? "CREATE_PROCEDURE" : "CREATE_FUNCTION";
  }

  if (nodeName === "ViewStmt") {
    const viewStmt = asRecord((ast as Record<string, unknown>).ViewStmt);
    const viewNode = asRecord(viewStmt?.view);
    const isMaterialized = viewNode?.relpersistence === "m";
    return isMaterialized ? "CREATE_MATERIALIZED_VIEW" : "CREATE_VIEW";
  }

  if (nodeName === "CreateTableAsStmt") {
    const createTableAsStmt = asRecord(
      (ast as Record<string, unknown>).CreateTableAsStmt,
    );
    const isMaterialized = createTableAsStmt?.objtype === "OBJECT_MATVIEW";
    return isMaterialized ? "CREATE_MATERIALIZED_VIEW" : "CREATE_TABLE";
  }

  if (nodeName === "DefineStmt") {
    const defineStmt = asRecord((ast as Record<string, unknown>).DefineStmt);
    if (defineStmt?.kind === "OBJECT_COLLATION") {
      return "CREATE_COLLATION";
    }
    if (defineStmt?.kind === "OBJECT_AGGREGATE") {
      return "CREATE_AGGREGATE";
    }
    if (defineStmt?.kind === "OBJECT_OPERATOR") {
      return "CREATE_OPERATOR";
    }
    if (defineStmt?.kind === "OBJECT_TYPE") {
      return "CREATE_TYPE";
    }
    return "UNKNOWN";
  }

  if (nodeName === "GrantStmt") {
    const grantStmt = (ast as Record<string, unknown>).GrantStmt as
      | Record<string, unknown>
      | undefined;
    const isGrant = grantStmt?.is_grant !== false;
    return isGrant ? "GRANT" : "REVOKE";
  }

  return statementClass;
};

const PHASE_BY_CLASS: Record<Exclude<StatementClass, "UNKNOWN">, PhaseTag> = {
  ALTER_DEFAULT_PRIVILEGES: "privileges",
  ALTER_OWNER: "privileges",
  ALTER_SEQUENCE: "pre_data",
  ALTER_TABLE: "data_structures",
  COMMENT: "privileges",
  DO: "bootstrap",
  CREATE_DOMAIN: "pre_data",
  CREATE_COLLATION: "pre_data",
  CREATE_EXTENSION: "bootstrap",
  CREATE_FOREIGN_DATA_WRAPPER: "bootstrap",
  CREATE_FOREIGN_SERVER: "bootstrap",
  CREATE_ACCESS_METHOD: "pre_data",
  CREATE_FUNCTION: "routines",
  CREATE_AGGREGATE: "routines",
  CREATE_INDEX: "post_data",
  CREATE_OPERATOR: "routines",
  CREATE_OPERATOR_CLASS: "pre_data",
  CREATE_OPERATOR_FAMILY: "pre_data",
  CREATE_LANGUAGE: "bootstrap",
  CREATE_MATERIALIZED_VIEW: "post_data",
  ALTER_PUBLICATION: "post_data",
  CREATE_PUBLICATION: "post_data",
  CREATE_POLICY: "post_data",
  CREATE_PROCEDURE: "routines",
  CREATE_RULE: "post_data",
  CREATE_ROLE: "bootstrap",
  CREATE_SCHEMA: "bootstrap",
  CREATE_SEQUENCE: "pre_data",
  ALTER_SUBSCRIPTION: "post_data",
  CREATE_SUBSCRIPTION: "post_data",
  CREATE_TABLE: "data_structures",
  CREATE_EVENT_TRIGGER: "post_data",
  CREATE_TRIGGER: "post_data",
  CREATE_TYPE: "pre_data",
  CREATE_VIEW: "post_data",
  GRANT: "privileges",
  REVOKE: "privileges",
  SELECT: "post_data",
  UPDATE: "post_data",
  VARIABLE_SET: "bootstrap",
};

export const phaseForStatementClass = (
  statementClass: StatementClass,
): PhaseTag => {
  if (statementClass === "UNKNOWN") {
    return "data_structures";
  }
  return PHASE_BY_CLASS[statementClass];
};

export const statementClassAstNode = (ast: unknown): string | undefined => {
  if (!ast || typeof ast !== "object") {
    return undefined;
  }
  return Object.keys(ast)[0];
};
