import type { CommentStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";

export function handleCommentStmt(ctx: ParseContext, node: CommentStmt) {
  if (!node.objtype) {
    throw new Error(
      `Undefined object type in comment stmt ${JSON.stringify(node)}`,
    );
  }
  switch (node.objtype) {
    case "OBJECT_ACCESS_METHOD":
      break;
    case "OBJECT_AGGREGATE":
      break;
    case "OBJECT_AMOP":
      break;
    case "OBJECT_AMPROC":
      break;
    case "OBJECT_ATTRIBUTE":
      break;
    case "OBJECT_CAST":
      break;
    case "OBJECT_COLLATION":
      break;
    case "OBJECT_COLUMN":
      break;
    case "OBJECT_CONVERSION":
      break;
    case "OBJECT_DATABASE":
      break;
    case "OBJECT_DEFAULT":
      break;
    case "OBJECT_DEFACL":
      break;
    case "OBJECT_DOMAIN":
      break;
    case "OBJECT_DOMCONSTRAINT":
      break;
    case "OBJECT_EVENT_TRIGGER":
      break;
    case "OBJECT_EXTENSION":
      break;
    case "OBJECT_FDW":
      break;
    case "OBJECT_FOREIGN_SERVER":
      break;
    case "OBJECT_FOREIGN_TABLE":
      break;
    case "OBJECT_FUNCTION":
      break;
    case "OBJECT_INDEX":
      break;
    case "OBJECT_LANGUAGE":
      break;
    case "OBJECT_LARGEOBJECT":
      break;
    case "OBJECT_MATVIEW":
      break;
    case "OBJECT_OPCLASS":
      break;
    case "OBJECT_OPERATOR":
      break;
    case "OBJECT_OPFAMILY":
      break;
    case "OBJECT_PARAMETER_ACL":
      break;
    case "OBJECT_POLICY":
      break;
    case "OBJECT_PROCEDURE":
      break;
    case "OBJECT_PUBLICATION":
      break;
    case "OBJECT_PUBLICATION_NAMESPACE":
      break;
    case "OBJECT_PUBLICATION_REL":
      break;
    case "OBJECT_ROLE":
      break;
    case "OBJECT_ROUTINE":
      break;
    case "OBJECT_RULE":
      break;
    case "OBJECT_SCHEMA":
      break;
    case "OBJECT_SEQUENCE":
      break;
    case "OBJECT_SUBSCRIPTION":
      break;
    case "OBJECT_STATISTIC_EXT":
      break;
    case "OBJECT_TABCONSTRAINT":
      break;
    case "OBJECT_TABLE":
      break;
    case "OBJECT_TABLESPACE":
      break;
    case "OBJECT_TRANSFORM":
      break;
    case "OBJECT_TRIGGER":
      break;
    case "OBJECT_TSCONFIGURATION":
      break;
    case "OBJECT_TSDICTIONARY":
      break;
    case "OBJECT_TSPARSER":
      break;
    case "OBJECT_TSTEMPLATE":
      break;
    case "OBJECT_TYPE":
      break;
    case "OBJECT_USER_MAPPING":
      break;
    case "OBJECT_VIEW":
      break;
    default:
      throw node.objtype satisfies never;
  }
}
