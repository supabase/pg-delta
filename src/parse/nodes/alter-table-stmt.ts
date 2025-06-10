import type { AlterTableStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import { isAlterTableCmd } from "./guards.ts";

export function handleAlterTableStmt(ctx: ParseContext, node: AlterTableStmt) {
  if (!node.objtype) {
    throw new Error(
      `Undefined object type in comment stmt ${JSON.stringify(node)}`,
    );
  }
  switch (node.objtype) {
    case "OBJECT_ACCESS_METHOD":
      throw new Error("Alter table for access method not implemented");
    case "OBJECT_AGGREGATE":
      throw new Error("Alter table for aggregate not implemented");
    case "OBJECT_AMOP":
      throw new Error("Alter table for access method operator not implemented");
    case "OBJECT_AMPROC":
      throw new Error(
        "Alter table for access method procedure not implemented",
      );
    case "OBJECT_ATTRIBUTE":
      throw new Error("Alter table for attribute not implemented");
    case "OBJECT_CAST":
      throw new Error("Alter table for cast not implemented");
    case "OBJECT_COLLATION":
      throw new Error("Alter table for collation not implemented");
    case "OBJECT_COLUMN":
      throw new Error("Alter table for column not implemented");
    case "OBJECT_CONVERSION":
      throw new Error("Alter table for conversion not implemented");
    case "OBJECT_DATABASE":
      throw new Error("Alter table for database not implemented");
    case "OBJECT_DEFAULT":
      throw new Error("Alter table for default not implemented");
    case "OBJECT_DEFACL":
      throw new Error("Alter table for default ACL not implemented");
    case "OBJECT_DOMAIN":
      throw new Error("Alter table for domain not implemented");
    case "OBJECT_DOMCONSTRAINT":
      throw new Error("Alter table for domain constraint not implemented");
    case "OBJECT_EVENT_TRIGGER":
      throw new Error("Alter table for event trigger not implemented");
    case "OBJECT_EXTENSION":
      throw new Error("Alter table for extension not implemented");
    case "OBJECT_FDW":
      throw new Error("Alter table for foreign data wrapper not implemented");
    case "OBJECT_FOREIGN_SERVER":
      throw new Error("Alter table for foreign server not implemented");
    case "OBJECT_FOREIGN_TABLE":
      throw new Error("Alter table for foreign table not implemented");
    case "OBJECT_FUNCTION":
      throw new Error("Alter table for function not implemented");
    case "OBJECT_INDEX": {
      // const id = `${node.relation?.schemaname}.${node.relation?.relname}`;
      // const index = ctx.indexes.get(id);
      // if (!index) {
      //   throw new Error(`Index ${id} not found`);
      // }

      // node.cmds?.forEach((cmd) => {
      //   if (isAlterTableCmd(cmd)) {
      //     if (!cmd.AlterTableCmd.subtype) return;
      //     switch (cmd.AlterTableCmd.subtype) {
      //       case "AT_ChangeOwner":
      //         index.owner = cmd.AlterTableCmd.newowner;
      //         break;
      //     }
      //   }
      // });
      break;
    }
    case "OBJECT_LANGUAGE":
      throw new Error("Alter table for language not implemented");
    case "OBJECT_LARGEOBJECT":
      throw new Error("Alter table for large object not implemented");
    case "OBJECT_MATVIEW":
      throw new Error("Alter table for materialized view not implemented");
    case "OBJECT_OPCLASS":
      throw new Error("Alter table for operator class not implemented");
    case "OBJECT_OPERATOR":
      throw new Error("Alter table for operator not implemented");
    case "OBJECT_OPFAMILY":
      throw new Error("Alter table for operator family not implemented");
    case "OBJECT_PARAMETER_ACL":
      throw new Error("Alter table for parameter ACL not implemented");
    case "OBJECT_POLICY":
      throw new Error("Alter table for policy not implemented");
    case "OBJECT_PROCEDURE":
      throw new Error("Alter table for procedure not implemented");
    case "OBJECT_PUBLICATION":
      throw new Error("Alter table for publication not implemented");
    case "OBJECT_PUBLICATION_NAMESPACE":
      throw new Error("Alter table for publication namespace not implemented");
    case "OBJECT_PUBLICATION_REL":
      throw new Error("Alter table for publication relation not implemented");
    case "OBJECT_ROLE":
      throw new Error("Alter table for role not implemented");
    case "OBJECT_ROUTINE":
      throw new Error("Alter table for routine not implemented");
    case "OBJECT_RULE":
      throw new Error("Alter table for rule not implemented");
    case "OBJECT_SCHEMA":
      throw new Error("Alter table for schema not implemented");
    case "OBJECT_SEQUENCE": {
      const id = `${node.relation?.schemaname}.${node.relation?.relname}`;
      const sequence = ctx.sequences.get(id);
      if (!sequence) {
        throw new Error(`Sequence ${id} not found`);
      }

      node.cmds?.forEach((cmd) => {
        if (isAlterTableCmd(cmd)) {
          if (!cmd.AlterTableCmd.subtype) return;
          switch (cmd.AlterTableCmd.subtype) {
            case "AT_ChangeOwner":
              sequence.owner = cmd.AlterTableCmd.newowner;
              break;
          }
        }
      });
      break;
    }
    // throw new Error("Alter table for sequence not implemented");
    case "OBJECT_SUBSCRIPTION":
      throw new Error("Alter table for subscription not implemented");
    case "OBJECT_STATISTIC_EXT":
      throw new Error("Alter table for statistics extension not implemented");
    case "OBJECT_TABCONSTRAINT":
      throw new Error("Alter table for table constraint not implemented");
    case "OBJECT_TABLE": {
      const id = `${node.relation?.schemaname}.${node.relation?.relname}`;
      const table = ctx.tables.get(id);
      if (!table) {
        throw new Error(`Table ${id} not found`);
      }

      node.cmds?.forEach((cmd) => {
        if (isAlterTableCmd(cmd)) {
          if (!cmd.AlterTableCmd.subtype) return;
          switch (cmd.AlterTableCmd.subtype) {
            case "AT_ChangeOwner":
              table.owner = cmd.AlterTableCmd.newowner;
              break;
            case "AT_AddColumn":
              throw new Error("Alter table for add column not implemented");
            case "AT_AddColumnToView":
              throw new Error(
                "Alter table for add column to view not implemented",
              );
            case "AT_ColumnDefault":
              throw new Error("Alter table for column default not implemented");
            case "AT_CookedColumnDefault":
              throw new Error(
                "Alter table for cooked column default not implemented",
              );
            case "AT_DropNotNull":
              throw new Error("Alter table for drop not null not implemented");
            case "AT_SetNotNull":
              throw new Error("Alter table for set not null not implemented");
            case "AT_SetExpression":
              throw new Error("Alter table for set expression not implemented");
            case "AT_DropExpression":
              throw new Error(
                "Alter table for drop expression not implemented",
              );
            case "AT_CheckNotNull":
              throw new Error("Alter table for check not null not implemented");
            case "AT_SetStatistics":
              throw new Error("Alter table for set statistics not implemented");
            case "AT_SetOptions":
              throw new Error("Alter table for set options not implemented");
            case "AT_ResetOptions":
              throw new Error("Alter table for reset options not implemented");
            case "AT_SetStorage":
              throw new Error("Alter table for set storage not implemented");
            case "AT_SetCompression":
              throw new Error(
                "Alter table for set compression not implemented",
              );
            case "AT_DropColumn":
              throw new Error("Alter table for drop column not implemented");
            case "AT_AddIndex":
              throw new Error("Alter table for add index not implemented");
            case "AT_ReAddIndex":
              throw new Error("Alter table for re-add index not implemented");
            case "AT_AddConstraint":
              throw new Error("Alter table for add constraint not implemented");
            case "AT_ReAddConstraint":
              throw new Error(
                "Alter table for re-add constraint not implemented",
              );
            case "AT_ReAddDomainConstraint":
              throw new Error(
                "Alter table for re-add domain constraint not implemented",
              );
            case "AT_AlterConstraint":
              throw new Error(
                "Alter table for alter constraint not implemented",
              );
            case "AT_ValidateConstraint":
              throw new Error(
                "Alter table for validate constraint not implemented",
              );
            case "AT_AddIndexConstraint":
              throw new Error(
                "Alter table for add index constraint not implemented",
              );
            case "AT_DropConstraint":
              throw new Error(
                "Alter table for drop constraint not implemented",
              );
            case "AT_ReAddComment":
              throw new Error("Alter table for re-add comment not implemented");
            case "AT_AlterColumnType":
              throw new Error(
                "Alter table for alter column type not implemented",
              );
            case "AT_AlterColumnGenericOptions":
              throw new Error(
                "Alter table for alter column generic options not implemented",
              );
            case "AT_ClusterOn":
              throw new Error("Alter table for cluster on not implemented");
            case "AT_DropCluster":
              throw new Error("Alter table for drop cluster not implemented");
            case "AT_SetLogged":
              throw new Error("Alter table for set logged not implemented");
            case "AT_SetUnLogged":
              throw new Error("Alter table for set unlogged not implemented");
            case "AT_DropOids":
              throw new Error("Alter table for drop oids not implemented");
            case "AT_SetAccessMethod":
              throw new Error(
                "Alter table for set access method not implemented",
              );
            case "AT_SetTableSpace":
              throw new Error(
                "Alter table for set table space not implemented",
              );
            case "AT_SetRelOptions":
              throw new Error(
                "Alter table for set rel options not implemented",
              );
            case "AT_ResetRelOptions":
              throw new Error(
                "Alter table for reset rel options not implemented",
              );
            case "AT_ReplaceRelOptions":
              throw new Error(
                "Alter table for replace rel options not implemented",
              );
            case "AT_EnableTrig":
              throw new Error("Alter table for enable trigger not implemented");
            case "AT_EnableAlwaysTrig":
              throw new Error(
                "Alter table for enable always trigger not implemented",
              );
            case "AT_EnableReplicaTrig":
              throw new Error(
                "Alter table for enable replica trigger not implemented",
              );
            case "AT_DisableTrig":
              throw new Error(
                "Alter table for disable trigger not implemented",
              );
            case "AT_EnableTrigAll":
              throw new Error(
                "Alter table for enable trigger all not implemented",
              );
            case "AT_DisableTrigAll":
              throw new Error(
                "Alter table for disable trigger all not implemented",
              );
            case "AT_EnableTrigUser":
              throw new Error(
                "Alter table for enable trigger user not implemented",
              );
            case "AT_DisableTrigUser":
              throw new Error(
                "Alter table for disable trigger user not implemented",
              );
            case "AT_EnableRule":
              throw new Error("Alter table for enable rule not implemented");
            case "AT_EnableAlwaysRule":
              throw new Error(
                "Alter table for enable always rule not implemented",
              );
            case "AT_EnableReplicaRule":
              throw new Error(
                "Alter table for enable replica rule not implemented",
              );
            case "AT_DisableRule":
              throw new Error("Alter table for disable rule not implemented");
            case "AT_AddInherit":
              throw new Error("Alter table for add inherit not implemented");
            case "AT_DropInherit":
              throw new Error("Alter table for drop inherit not implemented");
            case "AT_AddOf":
              throw new Error("Alter table for add of not implemented");
            case "AT_DropOf":
              throw new Error("Alter table for drop of not implemented");
            case "AT_ReplicaIdentity":
              throw new Error(
                "Alter table for replica identity not implemented",
              );
            case "AT_EnableRowSecurity":
              throw new Error(
                "Alter table for enable row security not implemented",
              );
            case "AT_DisableRowSecurity":
              throw new Error(
                "Alter table for disable row security not implemented",
              );
            case "AT_ForceRowSecurity":
              throw new Error(
                "Alter table for force row security not implemented",
              );
            case "AT_NoForceRowSecurity":
              throw new Error(
                "Alter table for no force row security not implemented",
              );
            case "AT_GenericOptions":
              throw new Error(
                "Alter table for generic options not implemented",
              );
            case "AT_AttachPartition":
              throw new Error(
                "Alter table for attach partition not implemented",
              );
            case "AT_DetachPartition":
              throw new Error(
                "Alter table for detach partition not implemented",
              );
            case "AT_DetachPartitionFinalize":
              throw new Error(
                "Alter table for detach partition finalize not implemented",
              );
            case "AT_AddIdentity":
              console.log(JSON.stringify(cmd, null, 2));
              throw new Error("Alter table for add identity not implemented");
            case "AT_SetIdentity":
              throw new Error("Alter table for set identity not implemented");
            case "AT_DropIdentity":
              throw new Error("Alter table for drop identity not implemented");
            case "AT_ReAddStatistics":
              throw new Error(
                "Alter table for re-add statistics not implemented",
              );
            default:
              throw cmd.AlterTableCmd.subtype satisfies never;
          }
        }
      });
      break;
    }
    case "OBJECT_TABLESPACE":
      throw new Error("Alter table for tablespace not implemented");
    case "OBJECT_TRANSFORM":
      throw new Error("Alter table for transform not implemented");
    case "OBJECT_TRIGGER":
      throw new Error("Alter table for trigger not implemented");
    case "OBJECT_TSCONFIGURATION":
      throw new Error(
        "Alter table for text search configuration not implemented",
      );
    case "OBJECT_TSDICTIONARY":
      throw new Error("Alter table for text search dictionary not implemented");
    case "OBJECT_TSPARSER":
      throw new Error("Alter table for text search parser not implemented");
    case "OBJECT_TSTEMPLATE":
      throw new Error("Alter table for text search template not implemented");
    case "OBJECT_TYPE":
      throw new Error("Alter table for type not implemented");
    case "OBJECT_USER_MAPPING":
      throw new Error("Alter table for user mapping not implemented");
    case "OBJECT_VIEW":
      throw new Error("Alter table for view not implemented");
    default:
      throw node.objtype satisfies never;
  }
}
