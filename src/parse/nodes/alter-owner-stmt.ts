import type { AlterOwnerStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import { getTypeId } from "./create-enum-stmt.ts";
import { isList, isString } from "./guards.ts";
import { getObjectIdentifier } from "./utils.ts";

export function handleAlterOwnerStmt(ctx: ParseContext, node: AlterOwnerStmt) {
  if (!node.objectType) {
    throw new Error(
      `Undefined object type in alter owner stmt ${JSON.stringify(node)}`,
    );
  }
  switch (node.objectType) {
    case "OBJECT_ACCESS_METHOD":
      throw new Error("Alter owner for access method not implemented");
    case "OBJECT_AGGREGATE":
      throw new Error("Alter owner for aggregate not implemented");
    case "OBJECT_AMOP":
      throw new Error("Alter owner for access method operator not implemented");
    case "OBJECT_AMPROC":
      throw new Error(
        "Alter owner for access method procedure not implemented",
      );
    case "OBJECT_ATTRIBUTE":
      throw new Error("Alter owner for attribute not implemented");
    case "OBJECT_CAST":
      throw new Error("Alter owner for cast not implemented");
    case "OBJECT_COLLATION":
      throw new Error("Alter owner for collation not implemented");
    case "OBJECT_COLUMN":
      throw new Error("Alter owner for column not implemented");
    case "OBJECT_CONVERSION":
      throw new Error("Alter owner for conversion not implemented");
    case "OBJECT_DATABASE":
      throw new Error("Alter owner for database not implemented");
    case "OBJECT_DEFAULT":
      throw new Error("Alter owner for default not implemented");
    case "OBJECT_DEFACL":
      throw new Error("Alter owner for default ACL not implemented");
    case "OBJECT_DOMAIN":
      throw new Error("Alter owner for domain not implemented");
    case "OBJECT_DOMCONSTRAINT":
      throw new Error("Alter owner for domain constraint not implemented");
    case "OBJECT_EVENT_TRIGGER":
      if (isString(node.object)) {
        const eventTriggerId = node.object.String.sval;
        const eventTrigger = ctx.eventTriggers.get(eventTriggerId);
        if (eventTrigger) {
          eventTrigger.owner = node.newowner;
        }
      }
      break;
    case "OBJECT_EXTENSION":
      throw new Error("Alter owner for extension not implemented");
    case "OBJECT_FDW":
      throw new Error("Alter owner for foreign data wrapper not implemented");
    case "OBJECT_FOREIGN_SERVER":
      throw new Error("Alter owner for foreign server not implemented");
    case "OBJECT_FOREIGN_TABLE":
      throw new Error("Alter owner for foreign table not implemented");
    case "OBJECT_FUNCTION":
      if (isList(node.object)) {
        const { id } = getObjectIdentifier(node.object.List.items);
        const fn = ctx.functions.get(id);
        if (fn) {
          fn.owner = node.newowner;
        }
      }
      break;
    case "OBJECT_INDEX":
      throw new Error("Alter owner for index not implemented");
    case "OBJECT_LANGUAGE":
      throw new Error("Alter owner for language not implemented");
    case "OBJECT_LARGEOBJECT":
      throw new Error("Alter owner for large object not implemented");
    case "OBJECT_MATVIEW":
      throw new Error("Alter owner for materialized view not implemented");
    case "OBJECT_OPCLASS":
      throw new Error("Alter owner for operator class not implemented");
    case "OBJECT_OPERATOR":
      throw new Error("Alter owner for operator not implemented");
    case "OBJECT_OPFAMILY":
      throw new Error("Alter owner for operator family not implemented");
    case "OBJECT_PARAMETER_ACL":
      throw new Error("Alter owner for parameter ACL not implemented");
    case "OBJECT_POLICY":
      throw new Error("Alter owner for policy not implemented");
    case "OBJECT_PROCEDURE":
      throw new Error("Alter owner for procedure not implemented");
    case "OBJECT_PUBLICATION":
      if (isString(node.object)) {
        const publicationId = node.object.String.sval;
        const publication = ctx.publications.get(publicationId);
        if (publication) {
          publication.owner = node.newowner;
        }
      }
      break;
    case "OBJECT_PUBLICATION_NAMESPACE":
      throw new Error("Alter owner for publication namespace not implemented");
    case "OBJECT_PUBLICATION_REL":
      throw new Error("Alter owner for publication relation not implemented");
    case "OBJECT_ROLE":
      throw new Error("Alter owner for role not implemented");
    case "OBJECT_ROUTINE":
      throw new Error("Alter owner for routine not implemented");
    case "OBJECT_RULE":
      throw new Error("Alter owner for rule not implemented");
    case "OBJECT_SCHEMA": {
      if (isString(node.object)) {
        const schemaName = node.object.String.sval;
        const schema = ctx.schemas.get(schemaName);
        if (schema) {
          schema.owner = node.newowner;
        }
      }
      break;
    }
    case "OBJECT_SEQUENCE":
      throw new Error("Alter owner for sequence not implemented");
    case "OBJECT_SUBSCRIPTION":
      throw new Error("Alter owner for subscription not implemented");
    case "OBJECT_STATISTIC_EXT":
      throw new Error("Alter owner for statistics extension not implemented");
    case "OBJECT_TABCONSTRAINT":
      throw new Error("Alter owner for table constraint not implemented");
    case "OBJECT_TABLE":
      throw new Error("Alter owner for table not implemented");
    case "OBJECT_TABLESPACE":
      throw new Error("Alter owner for tablespace not implemented");
    case "OBJECT_TRANSFORM":
      throw new Error("Alter owner for transform not implemented");
    case "OBJECT_TRIGGER":
      throw new Error("Alter owner for trigger not implemented");
    case "OBJECT_TSCONFIGURATION":
      throw new Error(
        "Alter owner for text search configuration not implemented",
      );
    case "OBJECT_TSDICTIONARY":
      throw new Error("Alter owner for text search dictionary not implemented");
    case "OBJECT_TSPARSER":
      throw new Error("Alter owner for text search parser not implemented");
    case "OBJECT_TSTEMPLATE":
      throw new Error("Alter owner for text search template not implemented");
    case "OBJECT_TYPE":
      if (isList(node.object)) {
        const typeId = getTypeId(node.object.List.items);
        const type = ctx.types.get(typeId);
        if (type) {
          type.owner = node.newowner;
        }
      }
      break;
    case "OBJECT_USER_MAPPING":
      throw new Error("Alter owner for user mapping not implemented");
    case "OBJECT_VIEW":
      throw new Error("Alter owner for view not implemented");
    default:
      throw node.objectType satisfies never;
  }
}
