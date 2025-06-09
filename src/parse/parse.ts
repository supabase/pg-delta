import { PgParser, unwrapParseResult } from "@supabase/pg-parser";
import { handleAlterOwnerStmt } from "./nodes/alter-owner-stmt.ts";
import { handleCommentStmt } from "./nodes/comment-stmt.ts";
import { handleCreateEnumStmt } from "./nodes/create-enum-stmt.ts";
import { handleCreateExtensionStmt } from "./nodes/create-extension-stmt.ts";
import { handleCreateSchemaStmt } from "./nodes/create-schema-stmt.ts";
import { handleCreateStmt } from "./nodes/create-stmt/create-stmt.ts";
import type { ParseContext } from "./types.ts";

/*
Node types in the initial Supabase schema:
console.log(new Set(tree.stmts?.flatMap((stmt) => Object.keys(stmt.stmt))));

'VariableSetStmt',
'SelectStmt',
'CreateSchemaStmt', X
'AlterOwnerStmt', X
'CreateExtensionStmt', X
'CommentStmt',
'CreateEnumStmt',
'CompositeTypeStmt',
'CreateFunctionStmt',
'CreateStmt',
'AlterTableStmt',
'CreateSeqStmt',
'AlterSeqStmt',
'IndexStmt',
'CreateTrigStmt',
'CreatePublicationStmt',
'GrantStmt',
'AlterDefaultPrivilegesStmt',
'CreateEventTrigStmt'
*/

export async function parse(schema: string) {
  const parser = new PgParser();
  const tree = await unwrapParseResult(parser.parse(schema));
  const ctx: ParseContext = {
    extensions: new Map(),
    schemas: new Map(),
    tables: new Map(),
    types: new Map(),
  };
  tree.stmts?.forEach((stmt) => {
    const node = stmt.stmt;

    if (!node) return;

    if ("ParseResult" in node) {
    } else if ("ScanResult" in node) {
      // Handle ScanResult
    } else if ("Integer" in node) {
      // Handle Integer
    } else if ("Float" in node) {
      // Handle Float
    } else if ("Boolean" in node) {
      // Handle Boolean
    } else if ("String" in node) {
      // Handle String
    } else if ("BitString" in node) {
      // Handle BitString
    } else if ("List" in node) {
      // Handle List
    } else if ("OidList" in node) {
      // Handle OidList
    } else if ("IntList" in node) {
      // Handle IntList
    } else if ("A_Const" in node) {
      // Handle A_Const
    } else if ("Alias" in node) {
      // Handle Alias
    } else if ("RangeVar" in node) {
      // Handle RangeVar
    } else if ("TableFunc" in node) {
      // Handle TableFunc
    } else if ("IntoClause" in node) {
      // Handle IntoClause
    } else if ("Var" in node) {
      // Handle Var
    } else if ("Param" in node) {
      // Handle Param
    } else if ("Aggref" in node) {
      // Handle Aggref
    } else if ("GroupingFunc" in node) {
      // Handle GroupingFunc
    } else if ("WindowFunc" in node) {
      // Handle WindowFunc
    } else if ("WindowFuncRunCondition" in node) {
      // Handle WindowFuncRunCondition
    } else if ("MergeSupportFunc" in node) {
      // Handle MergeSupportFunc
    } else if ("SubscriptingRef" in node) {
      // Handle SubscriptingRef
    } else if ("FuncExpr" in node) {
      // Handle FuncExpr
    } else if ("NamedArgExpr" in node) {
      // Handle NamedArgExpr
    } else if ("OpExpr" in node) {
      // Handle OpExpr
    } else if ("DistinctExpr" in node) {
      // Handle DistinctExpr
    } else if ("NullIfExpr" in node) {
      // Handle NullIfExpr
    } else if ("ScalarArrayOpExpr" in node) {
      // Handle ScalarArrayOpExpr
    } else if ("BoolExpr" in node) {
      // Handle BoolExpr
    } else if ("SubLink" in node) {
      // Handle SubLink
    } else if ("SubPlan" in node) {
      // Handle SubPlan
    } else if ("AlternativeSubPlan" in node) {
      // Handle AlternativeSubPlan
    } else if ("FieldSelect" in node) {
      // Handle FieldSelect
    } else if ("FieldStore" in node) {
      // Handle FieldStore
    } else if ("RelabelType" in node) {
      // Handle RelabelType
    } else if ("CoerceViaIO" in node) {
      // Handle CoerceViaIO
    } else if ("ArrayCoerceExpr" in node) {
      // Handle ArrayCoerceExpr
    } else if ("ConvertRowtypeExpr" in node) {
      // Handle ConvertRowtypeExpr
    } else if ("CollateExpr" in node) {
      // Handle CollateExpr
    } else if ("CaseExpr" in node) {
      // Handle CaseExpr
    } else if ("CaseWhen" in node) {
      // Handle CaseWhen
    } else if ("CaseTestExpr" in node) {
      // Handle CaseTestExpr
    } else if ("ArrayExpr" in node) {
      // Handle ArrayExpr
    } else if ("RowExpr" in node) {
      // Handle RowExpr
    } else if ("RowCompareExpr" in node) {
      // Handle RowCompareExpr
    } else if ("CoalesceExpr" in node) {
      // Handle CoalesceExpr
    } else if ("MinMaxExpr" in node) {
      // Handle MinMaxExpr
    } else if ("SQLValueFunction" in node) {
      // Handle SQLValueFunction
    } else if ("XmlExpr" in node) {
      // Handle XmlExpr
    } else if ("JsonFormat" in node) {
      // Handle JsonFormat
    } else if ("JsonReturning" in node) {
      // Handle JsonReturning
    } else if ("JsonValueExpr" in node) {
      // Handle JsonValueExpr
    } else if ("JsonConstructorExpr" in node) {
      // Handle JsonConstructorExpr
    } else if ("JsonIsPredicate" in node) {
      // Handle JsonIsPredicate
    } else if ("JsonBehavior" in node) {
      // Handle JsonBehavior
    } else if ("JsonExpr" in node) {
      // Handle JsonExpr
    } else if ("JsonTablePath" in node) {
      // Handle JsonTablePath
    } else if ("JsonTablePathScan" in node) {
      // Handle JsonTablePathScan
    } else if ("JsonTableSiblingJoin" in node) {
      // Handle JsonTableSiblingJoin
    } else if ("NullTest" in node) {
      // Handle NullTest
    } else if ("BooleanTest" in node) {
      // Handle BooleanTest
    } else if ("MergeAction" in node) {
      // Handle MergeAction
    } else if ("CoerceToDomain" in node) {
      // Handle CoerceToDomain
    } else if ("CoerceToDomainValue" in node) {
      // Handle CoerceToDomainValue
    } else if ("SetToDefault" in node) {
      // Handle SetToDefault
    } else if ("CurrentOfExpr" in node) {
      // Handle CurrentOfExpr
    } else if ("NextValueExpr" in node) {
      // Handle NextValueExpr
    } else if ("InferenceElem" in node) {
      // Handle InferenceElem
    } else if ("TargetEntry" in node) {
      // Handle TargetEntry
    } else if ("RangeTblRef" in node) {
      // Handle RangeTblRef
    } else if ("JoinExpr" in node) {
      // Handle JoinExpr
    } else if ("FromExpr" in node) {
      // Handle FromExpr
    } else if ("OnConflictExpr" in node) {
      // Handle OnConflictExpr
    } else if ("Query" in node) {
      // Handle Query
    } else if ("TypeName" in node) {
      // Handle TypeName
    } else if ("ColumnRef" in node) {
      // Handle ColumnRef
    } else if ("ParamRef" in node) {
      // Handle ParamRef
    } else if ("A_Expr" in node) {
      // Handle A_Expr
    } else if ("TypeCast" in node) {
      // Handle TypeCast
    } else if ("CollateClause" in node) {
      // Handle CollateClause
    } else if ("RoleSpec" in node) {
      // Handle RoleSpec
    } else if ("FuncCall" in node) {
      // Handle FuncCall
    } else if ("A_Star" in node) {
      // Handle A_Star
    } else if ("A_Indices" in node) {
      // Handle A_Indices
    } else if ("A_Indirection" in node) {
      // Handle A_Indirection
    } else if ("A_ArrayExpr" in node) {
      // Handle A_ArrayExpr
    } else if ("ResTarget" in node) {
      // Handle ResTarget
    } else if ("MultiAssignRef" in node) {
      // Handle MultiAssignRef
    } else if ("SortBy" in node) {
      // Handle SortBy
    } else if ("WindowDef" in node) {
      // Handle WindowDef
    } else if ("RangeSubselect" in node) {
      // Handle RangeSubselect
    } else if ("RangeFunction" in node) {
      // Handle RangeFunction
    } else if ("RangeTableFunc" in node) {
      // Handle RangeTableFunc
    } else if ("RangeTableFuncCol" in node) {
      // Handle RangeTableFuncCol
    } else if ("RangeTableSample" in node) {
      // Handle RangeTableSample
    } else if ("ColumnDef" in node) {
      // Handle ColumnDef
    } else if ("TableLikeClause" in node) {
      // Handle TableLikeClause
    } else if ("IndexElem" in node) {
      // Handle IndexElem
    } else if ("DefElem" in node) {
      // Handle DefElem
    } else if ("LockingClause" in node) {
      // Handle LockingClause
    } else if ("XmlSerialize" in node) {
      // Handle XmlSerialize
    } else if ("PartitionElem" in node) {
      // Handle PartitionElem
    } else if ("PartitionSpec" in node) {
      // Handle PartitionSpec
    } else if ("PartitionBoundSpec" in node) {
      // Handle PartitionBoundSpec
    } else if ("PartitionRangeDatum" in node) {
      // Handle PartitionRangeDatum
    } else if ("SinglePartitionSpec" in node) {
      // Handle SinglePartitionSpec
    } else if ("PartitionCmd" in node) {
      // Handle PartitionCmd
    } else if ("RangeTblEntry" in node) {
      // Handle RangeTblEntry
    } else if ("RTEPermissionInfo" in node) {
      // Handle RTEPermissionInfo
    } else if ("RangeTblFunction" in node) {
      // Handle RangeTblFunction
    } else if ("TableSampleClause" in node) {
      // Handle TableSampleClause
    } else if ("WithCheckOption" in node) {
      // Handle WithCheckOption
    } else if ("SortGroupClause" in node) {
      // Handle SortGroupClause
    } else if ("GroupingSet" in node) {
      // Handle GroupingSet
    } else if ("WindowClause" in node) {
      // Handle WindowClause
    } else if ("RowMarkClause" in node) {
      // Handle RowMarkClause
    } else if ("WithClause" in node) {
      // Handle WithClause
    } else if ("InferClause" in node) {
      // Handle InferClause
    } else if ("OnConflictClause" in node) {
      // Handle OnConflictClause
    } else if ("CTESearchClause" in node) {
      // Handle CTESearchClause
    } else if ("CTECycleClause" in node) {
      // Handle CTECycleClause
    } else if ("CommonTableExpr" in node) {
      // Handle CommonTableExpr
    } else if ("MergeWhenClause" in node) {
      // Handle MergeWhenClause
    } else if ("TriggerTransition" in node) {
      // Handle TriggerTransition
    } else if ("JsonOutput" in node) {
      // Handle JsonOutput
    } else if ("JsonArgument" in node) {
      // Handle JsonArgument
    } else if ("JsonFuncExpr" in node) {
      // Handle JsonFuncExpr
    } else if ("JsonTablePathSpec" in node) {
      // Handle JsonTablePathSpec
    } else if ("JsonTable" in node) {
      // Handle JsonTable
    } else if ("JsonTableColumn" in node) {
      // Handle JsonTableColumn
    } else if ("JsonKeyValue" in node) {
      // Handle JsonKeyValue
    } else if ("JsonParseExpr" in node) {
      // Handle JsonParseExpr
    } else if ("JsonScalarExpr" in node) {
      // Handle JsonScalarExpr
    } else if ("JsonSerializeExpr" in node) {
      // Handle JsonSerializeExpr
    } else if ("JsonObjectConstructor" in node) {
      // Handle JsonObjectConstructor
    } else if ("JsonArrayConstructor" in node) {
      // Handle JsonArrayConstructor
    } else if ("JsonArrayQueryConstructor" in node) {
      // Handle JsonArrayQueryConstructor
    } else if ("JsonAggConstructor" in node) {
      // Handle JsonAggConstructor
    } else if ("JsonObjectAgg" in node) {
      // Handle JsonObjectAgg
    } else if ("JsonArrayAgg" in node) {
      // Handle JsonArrayAgg
    } else if ("RawStmt" in node) {
      // Handle RawStmt
    } else if ("InsertStmt" in node) {
      // Handle InsertStmt
    } else if ("DeleteStmt" in node) {
      // Handle DeleteStmt
    } else if ("UpdateStmt" in node) {
      // Handle UpdateStmt
    } else if ("MergeStmt" in node) {
      // Handle MergeStmt
    } else if ("SelectStmt" in node) {
      // Handle SelectStmt
    } else if ("SetOperationStmt" in node) {
      // Handle SetOperationStmt
    } else if ("ReturnStmt" in node) {
      // Handle ReturnStmt
    } else if ("PLAssignStmt" in node) {
      // Handle PLAssignStmt
    } else if ("CreateSchemaStmt" in node) {
      handleCreateSchemaStmt(ctx, node.CreateSchemaStmt);
    } else if ("AlterTableStmt" in node) {
      // Handle AlterTableStmt
    } else if ("ReplicaIdentityStmt" in node) {
      // Handle ReplicaIdentityStmt
    } else if ("AlterTableCmd" in node) {
      // Handle AlterTableCmd
    } else if ("AlterCollationStmt" in node) {
      // Handle AlterCollationStmt
    } else if ("AlterDomainStmt" in node) {
      // Handle AlterDomainStmt
    } else if ("GrantStmt" in node) {
      // Handle GrantStmt
    } else if ("ObjectWithArgs" in node) {
      // Handle ObjectWithArgs
    } else if ("AccessPriv" in node) {
      // Handle AccessPriv
    } else if ("GrantRoleStmt" in node) {
      // Handle GrantRoleStmt
    } else if ("AlterDefaultPrivilegesStmt" in node) {
      // Handle AlterDefaultPrivilegesStmt
    } else if ("CopyStmt" in node) {
      // Handle CopyStmt
    } else if ("VariableSetStmt" in node) {
      // Handle VariableSetStmt
    } else if ("VariableShowStmt" in node) {
      // Handle VariableShowStmt
    } else if ("CreateStmt" in node) {
      handleCreateStmt(ctx, node.CreateStmt);
    } else if ("Constraint" in node) {
      // Handle Constraint
    } else if ("CreateTableSpaceStmt" in node) {
      // Handle CreateTableSpaceStmt
    } else if ("DropTableSpaceStmt" in node) {
      // Handle DropTableSpaceStmt
    } else if ("AlterTableSpaceOptionsStmt" in node) {
      // Handle AlterTableSpaceOptionsStmt
    } else if ("AlterTableMoveAllStmt" in node) {
      // Handle AlterTableMoveAllStmt
    } else if ("CreateExtensionStmt" in node) {
      handleCreateExtensionStmt(ctx, node.CreateExtensionStmt);
    } else if ("AlterExtensionStmt" in node) {
      // Handle AlterExtensionStmt
    } else if ("AlterExtensionContentsStmt" in node) {
      // Handle AlterExtensionContentsStmt
    } else if ("CreateFdwStmt" in node) {
      // Handle CreateFdwStmt
    } else if ("AlterFdwStmt" in node) {
      // Handle AlterFdwStmt
    } else if ("CreateForeignServerStmt" in node) {
      // Handle CreateForeignServerStmt
    } else if ("AlterForeignServerStmt" in node) {
      // Handle AlterForeignServerStmt
    } else if ("CreateForeignTableStmt" in node) {
      // Handle CreateForeignTableStmt
    } else if ("CreateUserMappingStmt" in node) {
      // Handle CreateUserMappingStmt
    } else if ("AlterUserMappingStmt" in node) {
      // Handle AlterUserMappingStmt
    } else if ("DropUserMappingStmt" in node) {
      // Handle DropUserMappingStmt
    } else if ("ImportForeignSchemaStmt" in node) {
      // Handle ImportForeignSchemaStmt
    } else if ("CreatePolicyStmt" in node) {
      // Handle CreatePolicyStmt
    } else if ("AlterPolicyStmt" in node) {
      // Handle AlterPolicyStmt
    } else if ("CreateAmStmt" in node) {
      // Handle CreateAmStmt
    } else if ("CreateTrigStmt" in node) {
      // Handle CreateTrigStmt
    } else if ("CreateEventTrigStmt" in node) {
      // Handle CreateEventTrigStmt
    } else if ("AlterEventTrigStmt" in node) {
      // Handle AlterEventTrigStmt
    } else if ("CreatePLangStmt" in node) {
      // Handle CreatePLangStmt
    } else if ("CreateRoleStmt" in node) {
      // Handle CreateRoleStmt
    } else if ("AlterRoleStmt" in node) {
      // Handle AlterRoleStmt
    } else if ("AlterRoleSetStmt" in node) {
      // Handle AlterRoleSetStmt
    } else if ("DropRoleStmt" in node) {
      // Handle DropRoleStmt
    } else if ("CreateSeqStmt" in node) {
      // Handle CreateSeqStmt
    } else if ("AlterSeqStmt" in node) {
      // Handle AlterSeqStmt
    } else if ("DefineStmt" in node) {
      // Handle DefineStmt
    } else if ("CreateDomainStmt" in node) {
      // Handle CreateDomainStmt
    } else if ("CreateOpClassStmt" in node) {
      // Handle CreateOpClassStmt
    } else if ("CreateOpClassItem" in node) {
      // Handle CreateOpClassItem
    } else if ("CreateOpFamilyStmt" in node) {
      // Handle CreateOpFamilyStmt
    } else if ("AlterOpFamilyStmt" in node) {
      // Handle AlterOpFamilyStmt
    } else if ("DropStmt" in node) {
      // Handle DropStmt
    } else if ("TruncateStmt" in node) {
      // Handle TruncateStmt
    } else if ("CommentStmt" in node) {
      handleCommentStmt(ctx, node.CommentStmt);
    } else if ("SecLabelStmt" in node) {
      // Handle SecLabelStmt
    } else if ("DeclareCursorStmt" in node) {
      // Handle DeclareCursorStmt
    } else if ("ClosePortalStmt" in node) {
      // Handle ClosePortalStmt
    } else if ("FetchStmt" in node) {
      // Handle FetchStmt
    } else if ("IndexStmt" in node) {
      // Handle IndexStmt
    } else if ("CreateStatsStmt" in node) {
      // Handle CreateStatsStmt
    } else if ("StatsElem" in node) {
      // Handle StatsElem
    } else if ("AlterStatsStmt" in node) {
      // Handle AlterStatsStmt
    } else if ("CreateFunctionStmt" in node) {
      // Handle CreateFunctionStmt
    } else if ("FunctionParameter" in node) {
      // Handle FunctionParameter
    } else if ("AlterFunctionStmt" in node) {
      // Handle AlterFunctionStmt
    } else if ("DoStmt" in node) {
      // Handle DoStmt
    } else if ("InlineCodeBlock" in node) {
      // Handle InlineCodeBlock
    } else if ("CallStmt" in node) {
      // Handle CallStmt
    } else if ("CallContext" in node) {
      // Handle CallContext
    } else if ("RenameStmt" in node) {
      // Handle RenameStmt
    } else if ("AlterObjectDependsStmt" in node) {
      // Handle AlterObjectDependsStmt
    } else if ("AlterObjectSchemaStmt" in node) {
      // Handle AlterObjectSchemaStmt
    } else if ("AlterOwnerStmt" in node) {
      handleAlterOwnerStmt(ctx, node.AlterOwnerStmt);
    } else if ("AlterOperatorStmt" in node) {
      // Handle AlterOperatorStmt
    } else if ("AlterTypeStmt" in node) {
      // Handle AlterTypeStmt
    } else if ("RuleStmt" in node) {
      // Handle RuleStmt
    } else if ("NotifyStmt" in node) {
      // Handle NotifyStmt
    } else if ("ListenStmt" in node) {
      // Handle ListenStmt
    } else if ("UnlistenStmt" in node) {
      // Handle UnlistenStmt
    } else if ("TransactionStmt" in node) {
      // Handle TransactionStmt
    } else if ("CompositeTypeStmt" in node) {
      // Handle CompositeTypeStmt
    } else if ("CreateEnumStmt" in node) {
      handleCreateEnumStmt(ctx, node.CreateEnumStmt);
    } else if ("CreateRangeStmt" in node) {
      // Handle CreateRangeStmt
    } else if ("AlterEnumStmt" in node) {
      // Handle AlterEnumStmt
    } else if ("ViewStmt" in node) {
      // Handle ViewStmt
    } else if ("LoadStmt" in node) {
      // Handle LoadStmt
    } else if ("CreatedbStmt" in node) {
      // Handle CreatedbStmt
    } else if ("AlterDatabaseStmt" in node) {
      // Handle AlterDatabaseStmt
    } else if ("AlterDatabaseRefreshCollStmt" in node) {
      // Handle AlterDatabaseRefreshCollStmt
    } else if ("AlterDatabaseSetStmt" in node) {
      // Handle AlterDatabaseSetStmt
    } else if ("DropdbStmt" in node) {
      // Handle DropdbStmt
    } else if ("AlterSystemStmt" in node) {
      // Handle AlterSystemStmt
    } else if ("ClusterStmt" in node) {
      // Handle ClusterStmt
    } else if ("VacuumStmt" in node) {
      // Handle VacuumStmt
    } else if ("VacuumRelation" in node) {
      // Handle VacuumRelation
    } else if ("ExplainStmt" in node) {
      // Handle ExplainStmt
    } else if ("CreateTableAsStmt" in node) {
      // Handle CreateTableAsStmt
    } else if ("RefreshMatViewStmt" in node) {
      // Handle RefreshMatViewStmt
    } else if ("CheckPointStmt" in node) {
      // Handle CheckPointStmt
    } else if ("DiscardStmt" in node) {
      // Handle DiscardStmt
    } else if ("LockStmt" in node) {
      // Handle LockStmt
    } else if ("ConstraintsSetStmt" in node) {
      // Handle ConstraintsSetStmt
    } else if ("ReindexStmt" in node) {
      // Handle ReindexStmt
    } else if ("CreateConversionStmt" in node) {
      // Handle CreateConversionStmt
    } else if ("CreateCastStmt" in node) {
      // Handle CreateCastStmt
    } else if ("CreateTransformStmt" in node) {
      // Handle CreateTransformStmt
    } else if ("PrepareStmt" in node) {
      // Handle PrepareStmt
    } else if ("ExecuteStmt" in node) {
      // Handle ExecuteStmt
    } else if ("DeallocateStmt" in node) {
      // Handle DeallocateStmt
    } else if ("DropOwnedStmt" in node) {
      // Handle DropOwnedStmt
    } else if ("ReassignOwnedStmt" in node) {
      // Handle ReassignOwnedStmt
    } else if ("AlterTSDictionaryStmt" in node) {
      // Handle AlterTSDictionaryStmt
    } else if ("AlterTSConfigurationStmt" in node) {
      // Handle AlterTSConfigurationStmt
    } else if ("PublicationTable" in node) {
      // Handle PublicationTable
    } else if ("PublicationObjSpec" in node) {
      // Handle PublicationObjSpec
    } else if ("CreatePublicationStmt" in node) {
      // Handle CreatePublicationStmt
    } else if ("AlterPublicationStmt" in node) {
      // Handle AlterPublicationStmt
    } else if ("CreateSubscriptionStmt" in node) {
      // Handle CreateSubscriptionStmt
    } else if ("AlterSubscriptionStmt" in node) {
      // Handle AlterSubscriptionStmt
    } else if ("DropSubscriptionStmt" in node) {
      // Handle DropSubscriptionStmt
    } else if ("ScanToken" in node) {
      // Handle ScanToken
    }
  });

  return { ctx, tree };
}
