import type { StatementClass } from "../classify/classify-statement.ts";
import {
  createObjectRef,
  createObjectRefFromAst,
  DEFAULT_SCHEMA,
  dedupeObjectRefs,
  splitQualifiedName,
} from "../model/object-ref.ts";
import type {
  AnnotationHints,
  ObjectRef,
  PrivilegeTarget,
} from "../model/types.ts";
import { asRecord } from "../utils/ast.ts";
import {
  addExpressionDependencies,
  addRoutineBodyDependencies,
} from "./expression-dependencies.ts";
import {
  addForeignConstraintDependencies,
  addSchemaDependencyIfNeeded,
  constraintKeyColumns,
  extractNameParts,
  extractStringValue,
  keyRefForTableColumns,
  objectFromNameParts,
  objectKindFromObjType,
  parseNamedObjectRef,
  relationFromRangeVarNode,
  roleNameFromRoleSpec,
  typeFromTypeNameNode,
} from "./shared-refs.ts";

type ExtractDependenciesResult = {
  provides: ObjectRef[];
  requires: ObjectRef[];
  privilege?: PrivilegeTarget;
};

const privilegeObjectKindFromObjType = (objtype: unknown): string => {
  switch (objtype) {
    case "OBJECT_TABLE":
      return "tables";
    case "OBJECT_SEQUENCE":
      return "sequences";
    case "OBJECT_FUNCTION":
      return "functions";
    case "OBJECT_PROCEDURE":
      return "procedures";
    case "OBJECT_ROUTINE":
      return "routines";
    case "OBJECT_TYPE":
      return "types";
    case "OBJECT_SCHEMA":
      return "schemas";
    default:
      return objectKindFromObjType(objtype) ?? "";
  }
};

const privilegesFromAccessPrivList = (
  privileges: unknown,
): string[] | "all" => {
  if (!Array.isArray(privileges) || privileges.length === 0) {
    return "all";
  }
  const names: string[] = [];
  for (const item of privileges) {
    const accessPriv = asRecord(asRecord(item)?.AccessPriv);
    const privName = accessPriv?.priv_name;
    if (typeof privName !== "string" || privName.length === 0) {
      return "all";
    }
    names.push(privName.toLowerCase());
  }
  return names;
};

const normalizedRoleName = (roleSpecNode: unknown): string | null => {
  const roleName = roleNameFromRoleSpec(roleSpecNode);
  if (!roleName) {
    return null;
  }
  return createObjectRefFromAst("role", roleName).name;
};

const roleNamesFromNodes = (nodes: unknown): string[] => {
  if (!Array.isArray(nodes)) {
    return [];
  }
  const names: string[] = [];
  for (const node of nodes) {
    const name = normalizedRoleName(asRecord(node)?.RoleSpec);
    if (name) {
      names.push(name);
    }
  }
  return names;
};

const privilegeFromGrantAction = (
  kind: PrivilegeTarget["kind"],
  action: Record<string, unknown> | undefined,
  grantors: string[],
  schemas: string[],
): PrivilegeTarget => {
  const isGrant = action?.is_grant === true;
  return {
    kind,
    isGrant,
    grantors,
    schemas,
    grantees: roleNamesFromNodes(action?.grantees),
    objectKind: privilegeObjectKindFromObjType(action?.objtype),
    privileges: privilegesFromAccessPrivList(action?.privileges),
  };
};

const extractCreateTableDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const relation = asRecord(statementNode.relation);
  const tableRef = relationFromRangeVarNode(relation, "table");
  if (tableRef) {
    provides.push(tableRef);
    addSchemaDependencyIfNeeded(relation?.schemaname, requires);
  }

  const inheritanceRelations = Array.isArray(statementNode.inhRelations)
    ? statementNode.inhRelations
    : [];
  for (const inheritanceRelationNode of inheritanceRelations) {
    const parentRelationRef = relationFromRangeVarNode(
      asRecord(inheritanceRelationNode)?.RangeVar ?? inheritanceRelationNode,
      "table",
    );
    if (parentRelationRef) {
      requires.push(parentRelationRef);
    }
  }

  const tableElements = Array.isArray(statementNode.tableElts)
    ? statementNode.tableElts
    : [];
  for (const tableElement of tableElements) {
    const elementNode = asRecord(tableElement);
    const columnDefinition = asRecord(elementNode?.ColumnDef);
    const tableConstraint = asRecord(elementNode?.Constraint);

    if (columnDefinition) {
      const typeRef = typeFromTypeNameNode(columnDefinition.typeName);
      if (typeRef) {
        requires.push(typeRef);
      }

      const constraints = Array.isArray(columnDefinition.constraints)
        ? columnDefinition.constraints
        : [];
      for (const constraintItem of constraints) {
        const constraint = asRecord(asRecord(constraintItem)?.Constraint);
        if (!constraint) {
          continue;
        }
        if (constraint.contype === "CONSTR_FOREIGN") {
          addForeignConstraintDependencies(constraint, requires);
        }
        if (
          tableRef &&
          (constraint.contype === "CONSTR_PRIMARY" ||
            constraint.contype === "CONSTR_UNIQUE")
        ) {
          const columnName =
            typeof columnDefinition.colname === "string"
              ? columnDefinition.colname
              : undefined;
          const providedKey = keyRefForTableColumns(
            tableRef,
            constraintKeyColumns(constraint, columnName),
          );
          if (providedKey) {
            provides.push(providedKey);
          }
        }
        if (constraint.raw_expr) {
          addExpressionDependencies(constraint.raw_expr, requires);
        }
      }
    }

    if (tableConstraint) {
      if (tableConstraint.contype === "CONSTR_FOREIGN") {
        addForeignConstraintDependencies(tableConstraint, requires);
      }
      if (
        tableRef &&
        (tableConstraint.contype === "CONSTR_PRIMARY" ||
          tableConstraint.contype === "CONSTR_UNIQUE")
      ) {
        const providedKey = keyRefForTableColumns(
          tableRef,
          constraintKeyColumns(tableConstraint),
        );
        if (providedKey) {
          provides.push(providedKey);
        }
      }
      if (tableConstraint.raw_expr) {
        addExpressionDependencies(tableConstraint.raw_expr, requires);
      }
    }
  }

  return { provides, requires };
};

const extractCreateTableAsDependencies = (
  statementNode: Record<string, unknown>,
  kind: "table" | "materialized_view",
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const intoClause = asRecord(statementNode.into);
  const relation = asRecord(intoClause?.rel);
  const relationRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    provides.push(
      createObjectRefFromAst(kind, relationRef.name, relationRef.schema),
    );
    if (relationRef.schema) {
      requires.push(createObjectRefFromAst("schema", relationRef.schema));
    }
  }

  addExpressionDependencies(statementNode.query, requires);
  return { provides, requires };
};

const addConstraintExpressionDependencies = (
  constraint: Record<string, unknown> | undefined,
  requires: ObjectRef[],
): void => {
  if (!constraint) {
    return;
  }
  for (const expressionNode of [
    constraint.raw_expr,
    constraint.exclusions,
    constraint.where_clause,
  ]) {
    if (expressionNode) {
      addExpressionDependencies(expressionNode, requires);
    }
  }
};

const extractAlterTableDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const objectKind = objectKindFromObjType(statementNode.objtype) ?? "table";
  const relation = asRecord(statementNode.relation);
  const relationRef = relationFromRangeVarNode(relation, objectKind);
  const relationTableRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    requires.push(relationRef);
  }

  const commands = Array.isArray(statementNode.cmds) ? statementNode.cmds : [];
  for (const commandNode of commands) {
    const command = asRecord(asRecord(commandNode)?.AlterTableCmd);
    const constraint = asRecord(asRecord(command?.def)?.Constraint);
    const columnDefinition = asRecord(asRecord(command?.def)?.ColumnDef);
    if (constraint?.contype === "CONSTR_FOREIGN") {
      addForeignConstraintDependencies(constraint, requires);
    }
    if (
      relationTableRef &&
      (constraint?.contype === "CONSTR_PRIMARY" ||
        constraint?.contype === "CONSTR_UNIQUE")
    ) {
      const providedKey = keyRefForTableColumns(
        relationTableRef,
        constraintKeyColumns(constraint),
      );
      if (providedKey) {
        provides.push(providedKey);
      }
    }
    addConstraintExpressionDependencies(constraint, requires);

    if (columnDefinition?.raw_default) {
      addExpressionDependencies(columnDefinition.raw_default, requires);
    }
    const typeRef = typeFromTypeNameNode(columnDefinition?.typeName);
    if (typeRef) {
      requires.push(typeRef);
    }
    const columnConstraints = Array.isArray(columnDefinition?.constraints)
      ? columnDefinition.constraints
      : [];
    for (const constraintItem of columnConstraints) {
      const columnConstraint = asRecord(asRecord(constraintItem)?.Constraint);
      if (columnConstraint?.contype === "CONSTR_FOREIGN") {
        addForeignConstraintDependencies(columnConstraint, requires);
      }
      if (
        relationTableRef &&
        (columnConstraint?.contype === "CONSTR_PRIMARY" ||
          columnConstraint?.contype === "CONSTR_UNIQUE")
      ) {
        const columnName =
          typeof columnDefinition?.colname === "string"
            ? columnDefinition.colname
            : undefined;
        const providedKey = keyRefForTableColumns(
          relationTableRef,
          constraintKeyColumns(columnConstraint, columnName),
        );
        if (providedKey) {
          provides.push(providedKey);
        }
      }
      addConstraintExpressionDependencies(columnConstraint, requires);
    }

    if (command?.subtype === "AT_ColumnDefault" && command.def) {
      addExpressionDependencies(command.def, requires);
    }

    if (command?.subtype === "AT_ChangeOwner") {
      const roleName = roleNameFromRoleSpec(command.newowner);
      if (roleName) {
        requires.push(createObjectRefFromAst("role", roleName));
      }
    }

    if (command?.subtype === "AT_AttachPartition") {
      const partitionCommand = asRecord(asRecord(command.def)?.PartitionCmd);
      const partitionName = partitionCommand?.name;
      const partitionRef = relationFromRangeVarNode(partitionName, objectKind);
      if (partitionRef) {
        requires.push(partitionRef);
      }
    }
  }

  return { provides, requires };
};

const extractCreateFunctionDependencies = (
  statementNode: Record<string, unknown>,
  kind: "function" | "procedure",
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const functionNameParts = extractNameParts(statementNode.funcname);
  const parameters = Array.isArray(statementNode.parameters)
    ? statementNode.parameters
    : [];
  const signatureParts: string[] = [];

  for (const parameterNode of parameters) {
    const functionParameter = asRecord(
      asRecord(parameterNode)?.FunctionParameter,
    );
    const argType = typeFromTypeNameNode(functionParameter?.argType);
    if (argType) {
      requires.push(argType);
      signatureParts.push(
        argType.schema ? `${argType.schema}.${argType.name}` : argType.name,
      );
    } else {
      signatureParts.push("unknown");
    }
  }

  const functionRef = objectFromNameParts(kind, functionNameParts);
  if (functionRef) {
    provides.push(
      createObjectRefFromAst(
        kind,
        functionRef.name,
        functionRef.schema,
        `(${signatureParts.join(",")})`,
      ),
    );
    if (functionRef.schema) {
      requires.push(createObjectRefFromAst("schema", functionRef.schema));
    }
  }

  const returnType = typeFromTypeNameNode(statementNode.returnType);
  if (returnType) {
    requires.push(returnType);
  }

  addRoutineBodyDependencies(statementNode, requires);

  return { provides, requires };
};

const extractViewDependencies = (
  statementNode: Record<string, unknown>,
  kind: "view" | "materialized_view",
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const viewRelation = asRecord(statementNode.view);
  const tableRef = relationFromRangeVarNode(viewRelation, "table");
  if (tableRef) {
    provides.push(createObjectRefFromAst(kind, tableRef.name, tableRef.schema));
    // A plain view implicitly owns an "_RETURN" ON SELECT rewrite rule. Expose it
    // so `COMMENT ON RULE "_RETURN" ON <view>` resolves to the view instead of
    // reporting an unresolved dependency. Materialized views have no such rule.
    if (kind === "view") {
      provides.push(
        createObjectRefFromAst(
          "rule",
          `${tableRef.name}._RETURN`,
          tableRef.schema ?? DEFAULT_SCHEMA,
        ),
      );
    }
    if (tableRef.schema) {
      requires.push(createObjectRefFromAst("schema", tableRef.schema));
    }
  }

  addExpressionDependencies(statementNode.query, requires);
  return { provides, requires };
};

const extractTriggerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relation = asRecord(statementNode.relation);
  const relationRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    const triggerName =
      typeof statementNode.trigname === "string"
        ? statementNode.trigname
        : "trigger";
    provides.push(
      createObjectRefFromAst(
        "trigger",
        `${relationRef.name}.${triggerName}`,
        relationRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    requires.push(relationRef);
  }

  const functionRef = objectFromNameParts(
    "function",
    extractNameParts(statementNode.funcname),
  );
  if (functionRef) {
    requires.push(functionRef);
  }

  return { provides, requires };
};

const extractRuleDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relation = asRecord(statementNode.relation);
  const relationRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    const ruleName =
      typeof statementNode.rulename === "string"
        ? statementNode.rulename
        : "rule";
    provides.push(
      createObjectRefFromAst(
        "rule",
        `${relationRef.name}.${ruleName}`,
        relationRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    requires.push(relationRef);
  }

  addExpressionDependencies(statementNode.whereClause, requires);

  const actions = Array.isArray(statementNode.actions)
    ? statementNode.actions
    : [];
  for (const action of actions) {
    addExpressionDependencies(action, requires);
  }

  return { provides, requires };
};

const extractPolicyDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relationRef = relationFromRangeVarNode(statementNode.table, "table");
  const policyName =
    typeof statementNode.policy_name === "string"
      ? statementNode.policy_name
      : "policy";
  if (relationRef) {
    provides.push(
      createObjectRefFromAst(
        "policy",
        `${relationRef.name}.${policyName}`,
        relationRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    requires.push(relationRef);
  }

  addExpressionDependencies(statementNode.qual, requires);
  addExpressionDependencies(statementNode.with_check, requires);
  return { provides, requires };
};

const extractGrantDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const objectKind = objectKindFromObjType(statementNode.objtype);
  const objects = Array.isArray(statementNode.objects)
    ? statementNode.objects
    : [];
  for (const objectNode of objects) {
    if (!objectKind) {
      continue;
    }
    const objectRef = parseNamedObjectRef(objectNode, objectKind);
    if (objectRef) {
      requires.push(objectRef);
    }
  }

  for (const roleName of roleNamesFromNodes(statementNode.grantees)) {
    requires.push(createObjectRefFromAst("role", roleName));
  }

  const isGrant = statementNode.is_grant === true;
  return {
    provides,
    requires,
    privilege: privilegeFromGrantAction(
      isGrant ? "grant" : "revoke",
      statementNode,
      [],
      [],
    ),
  };
};

const extractCommentDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const objectKind = objectKindFromObjType(statementNode.objtype);
  if (!objectKind) {
    return { provides: [], requires: [] };
  }
  const objectRef = parseNamedObjectRef(statementNode.object, objectKind);
  return {
    provides: [],
    requires: objectRef ? [objectRef] : [],
  };
};

const extractAlterOwnerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const requires: ObjectRef[] = [];
  const objectKind = objectKindFromObjType(statementNode.objectType);
  if (objectKind) {
    const objectRef = parseNamedObjectRef(statementNode.object, objectKind);
    if (objectRef) {
      requires.push(objectRef);
    }
  }

  const roleName = roleNameFromRoleSpec(statementNode.newowner);
  if (roleName) {
    requires.push(createObjectRefFromAst("role", roleName));
  }

  return { provides: [], requires };
};

const extractCreatePublicationDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.pubname === "string") {
    provides.push(createObjectRefFromAst("publication", statementNode.pubname));
  }

  addPublicationObjectDependencies(statementNode.pubobjects, requires);

  return { provides, requires };
};

const addPublicationObjectDependencies = (
  objects: unknown,
  requires: ObjectRef[],
): void => {
  const publicationObjects = Array.isArray(objects) ? objects : [];
  for (const objectNode of publicationObjects) {
    const publicationObjSpec = asRecord(
      asRecord(objectNode)?.PublicationObjSpec,
    );
    if (!publicationObjSpec) {
      continue;
    }
    const publicationObjType = publicationObjSpec.pubobjtype;
    const publicationTable = asRecord(publicationObjSpec.pubtable);
    if (publicationObjType === "PUBLICATIONOBJ_TABLE") {
      const relation = asRecord(publicationTable?.relation);
      const tableRef = relationFromRangeVarNode(relation, "table");
      if (tableRef) {
        requires.push(tableRef);
      }
      addExpressionDependencies(publicationTable?.whereClause, requires);
    }
    if (
      publicationObjType === "PUBLICATIONOBJ_TABLES_IN_SCHEMA" &&
      typeof publicationObjSpec.name === "string"
    ) {
      requires.push(createObjectRefFromAst("schema", publicationObjSpec.name));
    }
  }
};

const extractAlterPublicationDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const requires: ObjectRef[] = [];

  if (typeof statementNode.pubname === "string") {
    requires.push(createObjectRefFromAst("publication", statementNode.pubname));
  }

  if (
    statementNode.action === "AP_AddObjects" ||
    statementNode.action === "AP_DropObjects" ||
    statementNode.action === "AP_SetObjects"
  ) {
    addPublicationObjectDependencies(statementNode.pubobjects, requires);
  }

  return { provides: [], requires };
};

const extractCreateLanguageDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  if (typeof statementNode.plname === "string") {
    provides.push(createObjectRefFromAst("language", statementNode.plname));
  }
  return { provides, requires };
};

const extractCreateForeignDataWrapperDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  if (typeof statementNode.fdwname === "string") {
    provides.push(
      createObjectRefFromAst("foreign_data_wrapper", statementNode.fdwname),
    );
  }
  return { provides, requires };
};

const extractCreateForeignServerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.servername === "string") {
    provides.push(
      createObjectRefFromAst("foreign_server", statementNode.servername),
    );
  }
  if (typeof statementNode.fdwname === "string") {
    requires.push(
      createObjectRefFromAst("foreign_data_wrapper", statementNode.fdwname),
    );
  }

  return { provides, requires };
};

const extractCreateSubscriptionDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.subname === "string") {
    provides.push(
      createObjectRefFromAst("subscription", statementNode.subname),
    );
  }

  const publications = Array.isArray(statementNode.publication)
    ? statementNode.publication
    : [];
  for (const publicationNode of publications) {
    const publicationName = extractStringValue(publicationNode);
    if (publicationName) {
      requires.push(createObjectRefFromAst("publication", publicationName));
    }
  }

  return { provides, requires };
};

const extractAlterSubscriptionDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const requires: ObjectRef[] = [];

  if (typeof statementNode.subname === "string") {
    requires.push(
      createObjectRefFromAst("subscription", statementNode.subname),
    );
  }

  if (
    statementNode.kind === "ALTER_SUBSCRIPTION_SET_PUBLICATION" ||
    statementNode.kind === "ALTER_SUBSCRIPTION_ADD_PUBLICATION"
  ) {
    const publications = Array.isArray(statementNode.publication)
      ? statementNode.publication
      : [];
    for (const publicationNode of publications) {
      const publicationName = extractStringValue(publicationNode);
      if (publicationName) {
        requires.push(createObjectRefFromAst("publication", publicationName));
      }
    }
  }

  return { provides: [], requires };
};

const extractCreateEventTriggerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.trigname === "string") {
    provides.push(
      createObjectRefFromAst("event_trigger", statementNode.trigname),
    );
  }

  const functionRef = objectFromNameParts(
    "function",
    extractNameParts(statementNode.funcname),
  );
  if (functionRef) {
    requires.push(functionRef);
  }

  return { provides, requires };
};

const extractCreateCollationDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const collationRef = objectFromNameParts(
    "collation",
    extractNameParts(statementNode.defnames),
  );
  if (collationRef) {
    provides.push(collationRef);
    if (collationRef.schema) {
      requires.push(createObjectRefFromAst("schema", collationRef.schema));
    }
  }

  return { provides, requires };
};

const aggregateFunctionOptionNames = new Set([
  "sfunc",
  "finalfunc",
  "combinefunc",
  "serialfunc",
  "deserialfunc",
  "msfunc",
  "minvfunc",
  "mfinalfunc",
]);

const aggregateTypeOptionNames = new Set(["stype", "mstype"]);

const extractCreateAggregateDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const aggregateRef = objectFromNameParts(
    "aggregate",
    extractNameParts(statementNode.defnames),
  );
  const args = Array.isArray(statementNode.args) ? statementNode.args : [];
  const argList = asRecord(asRecord(args[0])?.List);
  const argItems = Array.isArray(argList?.items) ? argList.items : [];
  const signatureParts: string[] = [];
  for (const argNode of argItems) {
    const functionParameter = asRecord(asRecord(argNode)?.FunctionParameter);
    const argType = typeFromTypeNameNode(functionParameter?.argType);
    if (argType) {
      requires.push(argType);
      signatureParts.push(
        argType.schema ? `${argType.schema}.${argType.name}` : argType.name,
      );
    }
  }

  if (aggregateRef) {
    provides.push(
      createObjectRefFromAst(
        "aggregate",
        aggregateRef.name,
        aggregateRef.schema,
        signatureParts.length > 0 ? `(${signatureParts.join(",")})` : "()",
      ),
    );
    if (aggregateRef.schema) {
      requires.push(createObjectRefFromAst("schema", aggregateRef.schema));
    }
  }

  const options = Array.isArray(statementNode.definition)
    ? statementNode.definition
    : [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }
    const optionName = defElem.defname.toLowerCase();

    if (aggregateFunctionOptionNames.has(optionName)) {
      const functionTypeName = asRecord(asRecord(defElem.arg)?.TypeName);
      const functionRef = objectFromNameParts(
        "function",
        extractNameParts(functionTypeName?.names),
      );
      if (functionRef) {
        requires.push(functionRef);
      }
      continue;
    }

    if (aggregateTypeOptionNames.has(optionName)) {
      const typeRef = typeFromTypeNameNode(asRecord(defElem.arg)?.TypeName);
      if (typeRef) {
        requires.push(typeRef);
      }
    }
  }

  return { provides, requires };
};

const extractAlterSequenceDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const sequenceRef = relationFromRangeVarNode(
    statementNode.sequence,
    "sequence",
  );
  if (sequenceRef) {
    requires.push(sequenceRef);
  }

  const options = Array.isArray(statementNode.options)
    ? statementNode.options
    : [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (defElem?.defname !== "owned_by") {
      continue;
    }

    const listItems = asRecord(defElem.arg)?.List;
    const nameParts = extractNameParts(asRecord(listItems)?.items);
    if (nameParts.length >= 2) {
      const tableRef = objectFromNameParts("table", nameParts.slice(0, 2));
      if (tableRef) {
        requires.push(tableRef);
      }
    }
  }

  return { provides, requires };
};

const extractSelectDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  addExpressionDependencies(statementNode, requires);
  return { provides, requires };
};

const extractUpdateDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relationRef = relationFromRangeVarNode(statementNode.relation, "table");
  if (relationRef) {
    requires.push(relationRef);
  }

  addExpressionDependencies(statementNode.targetList, requires);
  addExpressionDependencies(statementNode.whereClause, requires);

  return { provides, requires };
};

const extractAlterDefaultPrivilegesDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const grantors: string[] = [];
  const schemas: string[] = [];

  const options = Array.isArray(statementNode.options)
    ? statementNode.options
    : [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem) {
      continue;
    }

    if (defElem.defname === "roles") {
      const roleItems = asRecord(asRecord(defElem.arg)?.List)?.items;
      const roles = Array.isArray(roleItems) ? roleItems : [];
      for (const roleNode of roles) {
        const roleName = roleNameFromRoleSpec(asRecord(roleNode)?.RoleSpec);
        if (roleName) {
          const ref = createObjectRefFromAst("role", roleName);
          requires.push(ref);
          grantors.push(ref.name);
        }
      }
    }

    if (defElem.defname === "schemas") {
      const schemaItems = asRecord(asRecord(defElem.arg)?.List)?.items;
      const names = extractNameParts(schemaItems);
      for (const schemaName of names) {
        const ref = createObjectRefFromAst("schema", schemaName);
        requires.push(ref);
        schemas.push(ref.name);
      }
    }
  }

  const action = asRecord(statementNode.action);
  const granteeItems = Array.isArray(action?.grantees) ? action.grantees : [];
  for (const granteeNode of granteeItems) {
    const roleName = roleNameFromRoleSpec(asRecord(granteeNode)?.RoleSpec);
    if (roleName) {
      requires.push(createObjectRefFromAst("role", roleName));
    }
  }

  return {
    provides,
    requires,
    privilege: privilegeFromGrantAction(
      "alter_default_privileges",
      action,
      grantors,
      schemas,
    ),
  };
};

const extractDoDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const args = Array.isArray(statementNode.args) ? statementNode.args : [];
  let body = "";
  for (const argNode of args) {
    const defElem = asRecord(asRecord(argNode)?.DefElem);
    if (defElem?.defname !== "as") {
      continue;
    }
    const text = extractStringValue(defElem.arg);
    if (text) {
      body = text;
      break;
    }
  }

  if (body.length === 0) {
    return { provides, requires };
  }

  const createTypeRegex = /create\s+type\s+([a-zA-Z0-9_."-]+)\s+as\s+enum/giu;
  for (const match of body.matchAll(createTypeRegex)) {
    const qualifiedName = match[1];
    if (!qualifiedName) {
      continue;
    }
    const { schema, name } = splitQualifiedName(qualifiedName, "raw");
    if (!name) {
      continue;
    }

    provides.push(createObjectRef("type", name, schema));
    if (schema) {
      requires.push(createObjectRef("schema", schema));
    }
  }

  return { provides, requires };
};

const extractDependencyRefs = (
  statementClass: StatementClass,
  ast: unknown,
): ExtractDependenciesResult => {
  const astNode = asRecord(ast);
  if (!astNode) {
    return { provides: [], requires: [] };
  }

  switch (statementClass) {
    case "CREATE_SCHEMA": {
      const createSchema = asRecord(astNode.CreateSchemaStmt);
      const name =
        typeof createSchema?.schemaname === "string"
          ? createSchema.schemaname
          : undefined;
      return {
        provides: name ? [createObjectRefFromAst("schema", name)] : [],
        requires: [],
      };
    }
    case "CREATE_LANGUAGE":
      return extractCreateLanguageDependencies(
        asRecord(astNode.CreatePLangStmt) ?? {},
      );
    case "CREATE_EXTENSION": {
      const createExtension = asRecord(astNode.CreateExtensionStmt);
      const extensionName =
        typeof createExtension?.extname === "string"
          ? createExtension.extname
          : undefined;
      let schemaName: string | undefined;
      const options = Array.isArray(createExtension?.options)
        ? createExtension.options
        : [];
      for (const optionNode of options) {
        const defElem = asRecord(asRecord(optionNode)?.DefElem);
        if (defElem?.defname !== "schema") {
          continue;
        }
        const optionValue = extractStringValue(defElem.arg);
        if (optionValue) {
          schemaName = optionValue;
        }
      }
      return {
        provides: extensionName
          ? [createObjectRefFromAst("extension", extensionName, schemaName)]
          : [],
        requires: schemaName
          ? [createObjectRefFromAst("schema", schemaName)]
          : [],
      };
    }
    case "CREATE_FOREIGN_DATA_WRAPPER":
      return extractCreateForeignDataWrapperDependencies(
        asRecord(astNode.CreateFdwStmt) ?? {},
      );
    case "CREATE_FOREIGN_SERVER":
      return extractCreateForeignServerDependencies(
        asRecord(astNode.CreateForeignServerStmt) ?? {},
      );
    case "CREATE_TYPE": {
      const compositeType = asRecord(astNode.CompositeTypeStmt);
      const compositeRef = relationFromRangeVarNode(
        compositeType?.typevar,
        "type",
      );
      const enumStmt = asRecord(astNode.CreateEnumStmt);
      const enumRef = objectFromNameParts(
        "type",
        extractNameParts(enumStmt?.typeName),
      );
      const typeRef = compositeRef ?? enumRef;
      return {
        provides: typeRef
          ? [createObjectRefFromAst("type", typeRef.name, typeRef.schema)]
          : [],
        requires: typeRef?.schema
          ? [createObjectRefFromAst("schema", typeRef.schema)]
          : [],
      };
    }
    case "CREATE_ROLE": {
      const createRole = asRecord(astNode.CreateRoleStmt);
      const roleName =
        typeof createRole?.role === "string" ? createRole.role : undefined;
      return {
        provides: roleName ? [createObjectRefFromAst("role", roleName)] : [],
        requires: [],
      };
    }
    case "CREATE_PUBLICATION":
      return extractCreatePublicationDependencies(
        asRecord(astNode.CreatePublicationStmt) ?? {},
      );
    case "ALTER_PUBLICATION":
      return extractAlterPublicationDependencies(
        asRecord(astNode.AlterPublicationStmt) ?? {},
      );
    case "CREATE_SUBSCRIPTION":
      return extractCreateSubscriptionDependencies(
        asRecord(astNode.CreateSubscriptionStmt) ?? {},
      );
    case "ALTER_SUBSCRIPTION":
      return extractAlterSubscriptionDependencies(
        asRecord(astNode.AlterSubscriptionStmt) ?? {},
      );
    case "CREATE_DOMAIN": {
      const createDomain = asRecord(astNode.CreateDomainStmt);
      const nameParts = extractNameParts(createDomain?.domainname);
      const domainRef = objectFromNameParts("domain", nameParts);
      const typeRef = typeFromTypeNameNode(createDomain?.typeName);
      const requires: ObjectRef[] = typeRef ? [typeRef] : [];

      const constraints = Array.isArray(createDomain?.constraints)
        ? createDomain.constraints
        : [];
      for (const constraintItem of constraints) {
        const constraint = asRecord(asRecord(constraintItem)?.Constraint);
        if (constraint?.raw_expr) {
          addExpressionDependencies(constraint.raw_expr, requires);
        }
      }

      return {
        provides: domainRef ? [domainRef] : [],
        requires,
      };
    }
    case "CREATE_SEQUENCE": {
      const createSequence = asRecord(astNode.CreateSeqStmt);
      const sequenceRangeVar = asRecord(createSequence?.sequence);
      const sequenceRef = relationFromRangeVarNode(
        sequenceRangeVar,
        "sequence",
      );
      return {
        provides: sequenceRef
          ? [
              createObjectRefFromAst(
                "sequence",
                sequenceRef.name,
                sequenceRef.schema,
              ),
            ]
          : [],
        requires: sequenceRef?.schema
          ? [createObjectRefFromAst("schema", sequenceRef.schema)]
          : [],
      };
    }
    case "ALTER_SEQUENCE":
      return extractAlterSequenceDependencies(
        asRecord(astNode.AlterSeqStmt) ?? {},
      );
    case "CREATE_TABLE":
      if (asRecord(astNode.CreateStmt)) {
        return extractCreateTableDependencies(
          asRecord(astNode.CreateStmt) ?? {},
        );
      }
      if (asRecord(astNode.CreateTableAsStmt)) {
        return extractCreateTableAsDependencies(
          asRecord(astNode.CreateTableAsStmt) ?? {},
          "table",
        );
      }
      return { provides: [], requires: [] };
    case "ALTER_TABLE":
      return extractAlterTableDependencies(
        asRecord(astNode.AlterTableStmt) ?? {},
      );
    case "CREATE_INDEX": {
      const indexStmt = asRecord(astNode.IndexStmt);
      const relationRef = relationFromRangeVarNode(
        indexStmt?.relation,
        "table",
      );
      const indexRef =
        typeof indexStmt?.idxname === "string"
          ? createObjectRefFromAst(
              "index",
              indexStmt.idxname,
              relationRef?.schema,
            )
          : null;
      const uniqueKeyProvides: ObjectRef[] = [];

      const isUnique = indexStmt?.unique === true;
      const hasPredicate = Boolean(indexStmt?.whereClause);
      if (isUnique && relationRef && !hasPredicate) {
        const indexParams = Array.isArray(indexStmt?.indexParams)
          ? indexStmt.indexParams
          : [];
        const indexColumns: string[] = [];
        let allColumnsNamed = true;
        for (const paramNode of indexParams) {
          const indexElem = asRecord(asRecord(paramNode)?.IndexElem);
          if (!indexElem) {
            allColumnsNamed = false;
            break;
          }
          if (typeof indexElem.name !== "string") {
            allColumnsNamed = false;
            break;
          }
          indexColumns.push(indexElem.name);
        }

        if (allColumnsNamed && indexColumns.length > 0) {
          const providedKey = keyRefForTableColumns(relationRef, indexColumns);
          if (providedKey) {
            uniqueKeyProvides.push(providedKey);
          }
        }
      }

      return {
        provides: dedupeObjectRefs([
          ...(indexRef ? [indexRef] : []),
          ...uniqueKeyProvides,
        ]),
        requires: relationRef ? [relationRef] : [],
      };
    }
    case "CREATE_FUNCTION":
      return extractCreateFunctionDependencies(
        asRecord(astNode.CreateFunctionStmt) ?? {},
        "function",
      );
    case "CREATE_PROCEDURE":
      return extractCreateFunctionDependencies(
        asRecord(astNode.CreateFunctionStmt) ?? {},
        "procedure",
      );
    case "CREATE_AGGREGATE":
      return extractCreateAggregateDependencies(
        asRecord(astNode.DefineStmt) ?? {},
      );
    case "CREATE_COLLATION":
      return extractCreateCollationDependencies(
        asRecord(astNode.DefineStmt) ?? {},
      );
    case "CREATE_VIEW":
      return extractViewDependencies(asRecord(astNode.ViewStmt) ?? {}, "view");
    case "CREATE_MATERIALIZED_VIEW":
      if (asRecord(astNode.ViewStmt)) {
        return extractViewDependencies(
          asRecord(astNode.ViewStmt) ?? {},
          "materialized_view",
        );
      }
      if (asRecord(astNode.CreateTableAsStmt)) {
        return extractCreateTableAsDependencies(
          asRecord(astNode.CreateTableAsStmt) ?? {},
          "materialized_view",
        );
      }
      return { provides: [], requires: [] };
    case "CREATE_TRIGGER":
      return extractTriggerDependencies(asRecord(astNode.CreateTrigStmt) ?? {});
    case "CREATE_RULE":
      return extractRuleDependencies(asRecord(astNode.RuleStmt) ?? {});
    case "CREATE_EVENT_TRIGGER":
      return extractCreateEventTriggerDependencies(
        asRecord(astNode.CreateEventTrigStmt) ?? {},
      );
    case "CREATE_POLICY":
      return extractPolicyDependencies(
        asRecord(astNode.CreatePolicyStmt) ?? {},
      );
    case "GRANT":
    case "REVOKE":
      return extractGrantDependencies(asRecord(astNode.GrantStmt) ?? {});
    case "ALTER_DEFAULT_PRIVILEGES":
      return extractAlterDefaultPrivilegesDependencies(
        asRecord(astNode.AlterDefaultPrivilegesStmt) ?? {},
      );
    case "SELECT":
      return extractSelectDependencies(asRecord(astNode.SelectStmt) ?? {});
    case "UPDATE":
      return extractUpdateDependencies(asRecord(astNode.UpdateStmt) ?? {});
    case "DO":
      return extractDoDependencies(asRecord(astNode.DoStmt) ?? {});
    case "VARIABLE_SET":
      return { provides: [], requires: [] };
    case "COMMENT":
      return extractCommentDependencies(asRecord(astNode.CommentStmt) ?? {});
    case "ALTER_OWNER":
      return extractAlterOwnerDependencies(
        asRecord(astNode.AlterOwnerStmt) ?? {},
      );
    case "UNKNOWN":
      return { provides: [], requires: [] };
  }
};

// When a pg-topo:requires annotation specifies a concrete signature for an
// object, any body-extracted requirement for the same kind:schema:name with an
// ambiguous (unknown-containing) signature is redundant. Keeping both would
// cause the ambiguous ref to trigger false-positive matching in the graph
// builder (e.g. cycle detection on overloaded functions). This filter removes
// the extracted refs that the annotations supersede.
const filterSupersededRequires = (
  extractedRequires: ObjectRef[],
  annotationRequires: ObjectRef[],
): ObjectRef[] => {
  if (annotationRequires.length === 0) {
    return extractedRequires;
  }
  const annotatedBaseKeys = new Set(
    annotationRequires
      .filter((ref) => ref.signature && !ref.signature.includes("unknown"))
      .map((ref) => `${ref.kind}:${ref.schema ?? ""}:${ref.name}`),
  );
  if (annotatedBaseKeys.size === 0) {
    return extractedRequires;
  }
  return extractedRequires.filter((ref) => {
    if (!ref.signature?.includes("unknown")) {
      return true;
    }
    const baseKey = `${ref.kind}:${ref.schema ?? ""}:${ref.name}`;
    return !annotatedBaseKeys.has(baseKey);
  });
};

export const extractDependencies = (
  statementClass: StatementClass,
  ast: unknown,
  annotations: AnnotationHints,
): ExtractDependenciesResult => {
  const extracted = extractDependencyRefs(statementClass, ast);
  return {
    provides: dedupeObjectRefs([
      ...extracted.provides,
      ...annotations.provides,
    ]),
    requires: dedupeObjectRefs([
      ...filterSupersededRequires(extracted.requires, annotations.requires),
      ...annotations.requires,
      ...annotations.dependsOn,
    ]),
    ...(extracted.privilege === undefined
      ? {}
      : { privilege: extracted.privilege }),
  };
};
