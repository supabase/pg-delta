import { PgParser, unwrapNode, unwrapParseResult } from "@supabase/pg-parser";
import { handleAlterOwnerStmt } from "./nodes/alter-owner-stmt.ts";
import { handleAlterTableStmt } from "./nodes/alter-table-stmt.ts";
import { handleCommentStmt } from "./nodes/comment-stmt.ts";
import { handleCompositeTypeStmt } from "./nodes/composite-type-stmt.ts";
import { handleCreateEnumStmt } from "./nodes/create-enum-stmt.ts";
import { handleCreateEventTrigStmt } from "./nodes/create-event-trig-stmt.ts";
import { handleCreateExtensionStmt } from "./nodes/create-extension-stmt.ts";
import { handleCreateFunctionStmt } from "./nodes/create-function-stmt.ts";
import { handleCreatePublicationStmt } from "./nodes/create-publication-stmt.ts";
import { handleCreateSchemaStmt } from "./nodes/create-schema-stmt.ts";
import { handleCreateSeqStmt } from "./nodes/create-seq-stmt.ts";
import { handleCreateStmt } from "./nodes/create-stmt/create-stmt.ts";
import type { ParseContext } from "./types/context.ts";

/*
Node types in the initial Supabase schema:
console.log(new Set(tree.stmts?.flatMap((stmt) => Object.keys(stmt.stmt))));

'VariableSetStmt',
'SelectStmt',
'CreateSchemaStmt', X
'AlterOwnerStmt', X
'CreateExtensionStmt', X
'CommentStmt', X
'CreateEnumStmt', X
'CompositeTypeStmt', X
'CreateFunctionStmt', X
'CreateStmt', X
'AlterTableStmt', 
'CreateSeqStmt',
'AlterSeqStmt',
'IndexStmt',
'CreateTrigStmt',
'CreatePublicationStmt', X
'GrantStmt',
'AlterDefaultPrivilegesStmt',
'CreateEventTrigStmt'
*/

export async function parse(schema: string) {
  const parser = new PgParser();

  const tree = await unwrapParseResult(parser.parse(schema));

  const ctx: ParseContext = {
    eventTriggers: new Map(),
    extensions: new Map(),
    functions: new Map(),
    indexes: new Map(),
    publications: new Map(),
    schemas: new Map(),
    sequences: new Map(),
    tables: new Map(),
    types: new Map(),
  };

  tree.stmts?.forEach((stmt) => {
    if (!stmt.stmt) return;

    const { type, node } = unwrapNode(stmt.stmt);

    switch (type) {
      case "ParseResult":
        break;
      case "ScanResult":
        // Handle ScanResult
        break;
      case "Integer":
        // Handle Integer
        break;
      case "Float":
        // Handle Float
        break;
      case "Boolean":
        // Handle Boolean
        break;
      case "String":
        // Handle String
        break;
      case "BitString":
        // Handle BitString
        break;
      case "List":
        // Handle List
        break;
      case "OidList":
        // Handle OidList
        break;
      case "IntList":
        // Handle IntList
        break;
      case "A_Const":
        // Handle A_Const
        break;
      case "Alias":
        // Handle Alias
        break;
      case "RangeVar":
        // Handle RangeVar
        break;
      case "TableFunc":
        // Handle TableFunc
        break;
      case "IntoClause":
        // Handle IntoClause
        break;
      case "Var":
        // Handle Var
        break;
      case "Param":
        // Handle Param
        break;
      case "Aggref":
        // Handle Aggref
        break;
      case "GroupingFunc":
        // Handle GroupingFunc
        break;
      case "WindowFunc":
        // Handle WindowFunc
        break;
      case "WindowFuncRunCondition":
        // Handle WindowFuncRunCondition
        break;
      case "MergeSupportFunc":
        // Handle MergeSupportFunc
        break;
      case "SubscriptingRef":
        // Handle SubscriptingRef
        break;
      case "FuncExpr":
        // Handle FuncExpr
        break;
      case "NamedArgExpr":
        // Handle NamedArgExpr
        break;
      case "OpExpr":
        // Handle OpExpr
        break;
      case "DistinctExpr":
        // Handle DistinctExpr
        break;
      case "NullIfExpr":
        // Handle NullIfExpr
        break;
      case "ScalarArrayOpExpr":
        // Handle ScalarArrayOpExpr
        break;
      case "BoolExpr":
        // Handle BoolExpr
        break;
      case "SubLink":
        // Handle SubLink
        break;
      case "SubPlan":
        // Handle SubPlan
        break;
      case "AlternativeSubPlan":
        // Handle AlternativeSubPlan
        break;
      case "FieldSelect":
        // Handle FieldSelect
        break;
      case "FieldStore":
        // Handle FieldStore
        break;
      case "RelabelType":
        // Handle RelabelType
        break;
      case "CoerceViaIO":
        // Handle CoerceViaIO
        break;
      case "ArrayCoerceExpr":
        // Handle ArrayCoerceExpr
        break;
      case "ConvertRowtypeExpr":
        // Handle ConvertRowtypeExpr
        break;
      case "CollateExpr":
        // Handle CollateExpr
        break;
      case "CaseExpr":
        // Handle CaseExpr
        break;
      case "CaseWhen":
        // Handle CaseWhen
        break;
      case "CaseTestExpr":
        // Handle CaseTestExpr
        break;
      case "ArrayExpr":
        // Handle ArrayExpr
        break;
      case "RowExpr":
        // Handle RowExpr
        break;
      case "RowCompareExpr":
        // Handle RowCompareExpr
        break;
      case "CoalesceExpr":
        // Handle CoalesceExpr
        break;
      case "MinMaxExpr":
        // Handle MinMaxExpr
        break;
      case "SQLValueFunction":
        // Handle SQLValueFunction
        break;
      case "XmlExpr":
        // Handle XmlExpr
        break;
      case "JsonFormat":
        // Handle JsonFormat
        break;
      case "JsonReturning":
        // Handle JsonReturning
        break;
      case "JsonValueExpr":
        // Handle JsonValueExpr
        break;
      case "JsonConstructorExpr":
        // Handle JsonConstructorExpr
        break;
      case "JsonIsPredicate":
        // Handle JsonIsPredicate
        break;
      case "JsonBehavior":
        // Handle JsonBehavior
        break;
      case "JsonExpr":
        // Handle JsonExpr
        break;
      case "JsonTablePath":
        // Handle JsonTablePath
        break;
      case "JsonTablePathScan":
        // Handle JsonTablePathScan
        break;
      case "JsonTableSiblingJoin":
        // Handle JsonTableSiblingJoin
        break;
      case "NullTest":
        // Handle NullTest
        break;
      case "BooleanTest":
        // Handle BooleanTest
        break;
      case "MergeAction":
        // Handle MergeAction
        break;
      case "CoerceToDomain":
        // Handle CoerceToDomain
        break;
      case "CoerceToDomainValue":
        // Handle CoerceToDomainValue
        break;
      case "SetToDefault":
        // Handle SetToDefault
        break;
      case "CurrentOfExpr":
        // Handle CurrentOfExpr
        break;
      case "NextValueExpr":
        // Handle NextValueExpr
        break;
      case "InferenceElem":
        // Handle InferenceElem
        break;
      case "TargetEntry":
        // Handle TargetEntry
        break;
      case "RangeTblRef":
        // Handle RangeTblRef
        break;
      case "JoinExpr":
        // Handle JoinExpr
        break;
      case "FromExpr":
        // Handle FromExpr
        break;
      case "OnConflictExpr":
        // Handle OnConflictExpr
        break;
      case "Query":
        // Handle Query
        break;
      case "TypeName":
        // Handle TypeName
        break;
      case "ColumnRef":
        // Handle ColumnRef
        break;
      case "ParamRef":
        // Handle ParamRef
        break;
      case "A_Expr":
        // Handle A_Expr
        break;
      case "TypeCast":
        // Handle TypeCast
        break;
      case "CollateClause":
        // Handle CollateClause
        break;
      case "RoleSpec":
        // Handle RoleSpec
        break;
      case "FuncCall":
        // Handle FuncCall
        break;
      case "A_Star":
        // Handle A_Star
        break;
      case "A_Indices":
        // Handle A_Indices
        break;
      case "A_Indirection":
        // Handle A_Indirection
        break;
      case "A_ArrayExpr":
        // Handle A_ArrayExpr
        break;
      case "ResTarget":
        // Handle ResTarget
        break;
      case "MultiAssignRef":
        // Handle MultiAssignRef
        break;
      case "SortBy":
        // Handle SortBy
        break;
      case "WindowDef":
        // Handle WindowDef
        break;
      case "RangeSubselect":
        // Handle RangeSubselect
        break;
      case "RangeFunction":
        // Handle RangeFunction
        break;
      case "RangeTableFunc":
        // Handle RangeTableFunc
        break;
      case "RangeTableFuncCol":
        // Handle RangeTableFuncCol
        break;
      case "RangeTableSample":
        // Handle RangeTableSample
        break;
      case "ColumnDef":
        // Handle ColumnDef
        break;
      case "TableLikeClause":
        // Handle TableLikeClause
        break;
      case "IndexElem":
        // Handle IndexElem
        break;
      case "DefElem":
        // Handle DefElem
        break;
      case "LockingClause":
        // Handle LockingClause
        break;
      case "XmlSerialize":
        // Handle XmlSerialize
        break;
      case "PartitionElem":
        // Handle PartitionElem
        break;
      case "PartitionSpec":
        // Handle PartitionSpec
        break;
      case "PartitionBoundSpec":
        // Handle PartitionBoundSpec
        break;
      case "PartitionRangeDatum":
        // Handle PartitionRangeDatum
        break;
      case "SinglePartitionSpec":
        // Handle SinglePartitionSpec
        break;
      case "PartitionCmd":
        // Handle PartitionCmd
        break;
      case "RangeTblEntry":
        // Handle RangeTblEntry
        break;
      case "RTEPermissionInfo":
        // Handle RTEPermissionInfo
        break;
      case "RangeTblFunction":
        // Handle RangeTblFunction
        break;
      case "TableSampleClause":
        // Handle TableSampleClause
        break;
      case "WithCheckOption":
        // Handle WithCheckOption
        break;
      case "SortGroupClause":
        // Handle SortGroupClause
        break;
      case "GroupingSet":
        // Handle GroupingSet
        break;
      case "WindowClause":
        // Handle WindowClause
        break;
      case "RowMarkClause":
        // Handle RowMarkClause
        break;
      case "WithClause":
        // Handle WithClause
        break;
      case "InferClause":
        // Handle InferClause
        break;
      case "OnConflictClause":
        // Handle OnConflictClause
        break;
      case "CTESearchClause":
        // Handle CTESearchClause
        break;
      case "CTECycleClause":
        // Handle CTECycleClause
        break;
      case "CommonTableExpr":
        // Handle CommonTableExpr
        break;
      case "MergeWhenClause":
        // Handle MergeWhenClause
        break;
      case "TriggerTransition":
        // Handle TriggerTransition
        break;
      case "JsonOutput":
        // Handle JsonOutput
        break;
      case "JsonArgument":
        // Handle JsonArgument
        break;
      case "JsonFuncExpr":
        // Handle JsonFuncExpr
        break;
      case "JsonTablePathSpec":
        // Handle JsonTablePathSpec
        break;
      case "JsonTable":
        // Handle JsonTable
        break;
      case "JsonTableColumn":
        // Handle JsonTableColumn
        break;
      case "JsonKeyValue":
        // Handle JsonKeyValue
        break;
      case "JsonParseExpr":
        // Handle JsonParseExpr
        break;
      case "JsonScalarExpr":
        // Handle JsonScalarExpr
        break;
      case "JsonSerializeExpr":
        // Handle JsonSerializeExpr
        break;
      case "JsonObjectConstructor":
        // Handle JsonObjectConstructor
        break;
      case "JsonArrayConstructor":
        // Handle JsonArrayConstructor
        break;
      case "JsonArrayQueryConstructor":
        // Handle JsonArrayQueryConstructor
        break;
      case "JsonAggConstructor":
        // Handle JsonAggConstructor
        break;
      case "JsonObjectAgg":
        // Handle JsonObjectAgg
        break;
      case "JsonArrayAgg":
        // Handle JsonArrayAgg
        break;
      case "RawStmt":
        // Handle RawStmt
        break;
      case "InsertStmt":
        // Handle InsertStmt
        break;
      case "DeleteStmt":
        // Handle DeleteStmt
        break;
      case "UpdateStmt":
        // Handle UpdateStmt
        break;
      case "MergeStmt":
        // Handle MergeStmt
        break;
      case "SelectStmt":
        // Handle SelectStmt
        break;
      case "SetOperationStmt":
        // Handle SetOperationStmt
        break;
      case "ReturnStmt":
        // Handle ReturnStmt
        break;
      case "PLAssignStmt":
        // Handle PLAssignStmt
        break;
      case "CreateSchemaStmt":
        handleCreateSchemaStmt(ctx, node);
        break;
      case "AlterTableStmt":
        handleAlterTableStmt(ctx, node);
        break;
      case "ReplicaIdentityStmt":
        // Handle ReplicaIdentityStmt
        break;
      case "AlterTableCmd":
        // Handle AlterTableCmd
        break;
      case "AlterCollationStmt":
        // Handle AlterCollationStmt
        break;
      case "AlterDomainStmt":
        // Handle AlterDomainStmt
        break;
      case "GrantStmt":
        // Handle GrantStmt
        break;
      case "ObjectWithArgs":
        // Handle ObjectWithArgs
        break;
      case "AccessPriv":
        // Handle AccessPriv
        break;
      case "GrantRoleStmt":
        // Handle GrantRoleStmt
        break;
      case "AlterDefaultPrivilegesStmt":
        // Handle AlterDefaultPrivilegesStmt
        break;
      case "CopyStmt":
        // Handle CopyStmt
        break;
      case "VariableSetStmt":
        // Handle VariableSetStmt
        break;
      case "VariableShowStmt":
        // Handle VariableShowStmt
        break;
      case "CreateStmt":
        handleCreateStmt(ctx, node);
        break;
      case "Constraint":
        // Handle Constraint
        break;
      case "CreateTableSpaceStmt":
        // Handle CreateTableSpaceStmt
        break;
      case "DropTableSpaceStmt":
        // Handle DropTableSpaceStmt
        break;
      case "AlterTableSpaceOptionsStmt":
        // Handle AlterTableSpaceOptionsStmt
        break;
      case "AlterTableMoveAllStmt":
        // Handle AlterTableMoveAllStmt
        break;
      case "CreateExtensionStmt":
        handleCreateExtensionStmt(ctx, node);
        break;
      case "AlterExtensionStmt":
        // Handle AlterExtensionStmt
        break;
      case "AlterExtensionContentsStmt":
        // Handle AlterExtensionContentsStmt
        break;
      case "CreateFdwStmt":
        // Handle CreateFdwStmt
        break;
      case "AlterFdwStmt":
        // Handle AlterFdwStmt
        break;
      case "CreateForeignServerStmt":
        // Handle CreateForeignServerStmt
        break;
      case "AlterForeignServerStmt":
        // Handle AlterForeignServerStmt
        break;
      case "CreateForeignTableStmt":
        // Handle CreateForeignTableStmt
        break;
      case "CreateUserMappingStmt":
        // Handle CreateUserMappingStmt
        break;
      case "AlterUserMappingStmt":
        // Handle AlterUserMappingStmt
        break;
      case "DropUserMappingStmt":
        // Handle DropUserMappingStmt
        break;
      case "ImportForeignSchemaStmt":
        // Handle ImportForeignSchemaStmt
        break;
      case "CreatePolicyStmt":
        // Handle CreatePolicyStmt
        break;
      case "AlterPolicyStmt":
        // Handle AlterPolicyStmt
        break;
      case "CreateAmStmt":
        // Handle CreateAmStmt
        break;
      case "CreateTrigStmt":
        // Handle CreateTrigStmt
        break;
      case "CreateEventTrigStmt":
        handleCreateEventTrigStmt(ctx, node);
        break;
      case "AlterEventTrigStmt":
        // Handle AlterEventTrigStmt
        break;
      case "CreatePLangStmt":
        // Handle CreatePLangStmt
        break;
      case "CreateRoleStmt":
        // Handle CreateRoleStmt
        break;
      case "AlterRoleStmt":
        // Handle AlterRoleStmt
        break;
      case "AlterRoleSetStmt":
        // Handle AlterRoleSetStmt
        break;
      case "DropRoleStmt":
        // Handle DropRoleStmt
        break;
      case "CreateSeqStmt":
        handleCreateSeqStmt(ctx, node);
        break;
      case "AlterSeqStmt":
        // Handle AlterSeqStmt
        break;
      case "DefineStmt":
        // Handle DefineStmt
        break;
      case "CreateDomainStmt":
        // Handle CreateDomainStmt
        break;
      case "CreateOpClassStmt":
        // Handle CreateOpClassStmt
        break;
      case "CreateOpClassItem":
        // Handle CreateOpClassItem
        break;
      case "CreateOpFamilyStmt":
        // Handle CreateOpFamilyStmt
        break;
      case "AlterOpFamilyStmt":
        // Handle AlterOpFamilyStmt
        break;
      case "DropStmt":
        // Handle DropStmt
        break;
      case "TruncateStmt":
        // Handle TruncateStmt
        break;
      case "CommentStmt":
        handleCommentStmt(ctx, node);
        break;
      case "SecLabelStmt":
        // Handle SecLabelStmt
        break;
      case "DeclareCursorStmt":
        // Handle DeclareCursorStmt
        break;
      case "ClosePortalStmt":
        // Handle ClosePortalStmt
        break;
      case "FetchStmt":
        // Handle FetchStmt
        break;
      case "IndexStmt":
        // Handle IndexStmt
        break;
      case "CreateStatsStmt":
        // Handle CreateStatsStmt
        break;
      case "StatsElem":
        // Handle StatsElem
        break;
      case "AlterStatsStmt":
        // Handle AlterStatsStmt
        break;
      case "CreateFunctionStmt":
        handleCreateFunctionStmt(ctx, node);
        break;
      case "FunctionParameter":
        // Handle FunctionParameter
        break;
      case "AlterFunctionStmt":
        // Handle AlterFunctionStmt
        break;
      case "DoStmt":
        // Handle DoStmt
        break;
      case "InlineCodeBlock":
        // Handle InlineCodeBlock
        break;
      case "CallStmt":
        // Handle CallStmt
        break;
      case "CallContext":
        // Handle CallContext
        break;
      case "RenameStmt":
        // Handle RenameStmt
        break;
      case "AlterObjectDependsStmt":
        // Handle AlterObjectDependsStmt
        break;
      case "AlterObjectSchemaStmt":
        // Handle AlterObjectSchemaStmt
        break;
      case "AlterOwnerStmt":
        handleAlterOwnerStmt(ctx, node);
        break;
      case "AlterOperatorStmt":
        // Handle AlterOperatorStmt
        break;
      case "AlterTypeStmt":
        // Handle AlterTypeStmt
        break;
      case "RuleStmt":
        // Handle RuleStmt
        break;
      case "NotifyStmt":
        // Handle NotifyStmt
        break;
      case "ListenStmt":
        // Handle ListenStmt
        break;
      case "UnlistenStmt":
        // Handle UnlistenStmt
        break;
      case "TransactionStmt":
        // Handle TransactionStmt
        break;
      case "CompositeTypeStmt":
        handleCompositeTypeStmt(ctx, node);
        break;
      case "CreateEnumStmt":
        handleCreateEnumStmt(ctx, node);
        break;
      case "CreateRangeStmt":
        // Handle CreateRangeStmt
        break;
      case "AlterEnumStmt":
        // Handle AlterEnumStmt
        break;
      case "ViewStmt":
        // Handle ViewStmt
        break;
      case "LoadStmt":
        // Handle LoadStmt
        break;
      case "CreatedbStmt":
        // Handle CreatedbStmt
        break;
      case "AlterDatabaseStmt":
        // Handle AlterDatabaseStmt
        break;
      case "AlterDatabaseRefreshCollStmt":
        // Handle AlterDatabaseRefreshCollStmt
        break;
      case "AlterDatabaseSetStmt":
        // Handle AlterDatabaseSetStmt
        break;
      case "DropdbStmt":
        // Handle DropdbStmt
        break;
      case "AlterSystemStmt":
        // Handle AlterSystemStmt
        break;
      case "ClusterStmt":
        // Handle ClusterStmt
        break;
      case "VacuumStmt":
        // Handle VacuumStmt
        break;
      case "VacuumRelation":
        // Handle VacuumRelation
        break;
      case "ExplainStmt":
        // Handle ExplainStmt
        break;
      case "CreateTableAsStmt":
        // Handle CreateTableAsStmt
        break;
      case "RefreshMatViewStmt":
        // Handle RefreshMatViewStmt
        break;
      case "CheckPointStmt":
        // Handle CheckPointStmt
        break;
      case "DiscardStmt":
        // Handle DiscardStmt
        break;
      case "LockStmt":
        // Handle LockStmt
        break;
      case "ConstraintsSetStmt":
        // Handle ConstraintsSetStmt
        break;
      case "ReindexStmt":
        // Handle ReindexStmt
        break;
      case "CreateConversionStmt":
        // Handle CreateConversionStmt
        break;
      case "CreateCastStmt":
        // Handle CreateCastStmt
        break;
      case "CreateTransformStmt":
        // Handle CreateTransformStmt
        break;
      case "PrepareStmt":
        // Handle PrepareStmt
        break;
      case "ExecuteStmt":
        // Handle ExecuteStmt
        break;
      case "DeallocateStmt":
        // Handle DeallocateStmt
        break;
      case "DropOwnedStmt":
        // Handle DropOwnedStmt
        break;
      case "ReassignOwnedStmt":
        // Handle ReassignOwnedStmt
        break;
      case "AlterTSDictionaryStmt":
        // Handle AlterTSDictionaryStmt
        break;
      case "AlterTSConfigurationStmt":
        // Handle AlterTSConfigurationStmt
        break;
      case "PublicationTable":
        // Handle PublicationTable
        break;
      case "PublicationObjSpec":
        // Handle PublicationObjSpec
        break;
      case "CreatePublicationStmt":
        handleCreatePublicationStmt(ctx, node);
        break;
      case "AlterPublicationStmt":
        // Handle AlterPublicationStmt
        break;
      case "CreateSubscriptionStmt":
        // Handle CreateSubscriptionStmt
        break;
      case "AlterSubscriptionStmt":
        // Handle AlterSubscriptionStmt
        break;
      case "DropSubscriptionStmt":
        // Handle DropSubscriptionStmt
        break;
      case "ScanToken":
        // Handle ScanToken
        break;
      default:
        throw type satisfies never;
    }
  });

  return { ctx, tree };
}
