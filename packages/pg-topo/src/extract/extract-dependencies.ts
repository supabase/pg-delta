import type { StatementClass } from "../classify/classify-statement.ts";
import { signaturesCompatible } from "../model/object-compat.ts";
import {
  createObjectRef,
  createObjectRefFromAst,
  DEFAULT_SCHEMA,
  dedupeObjectRefs,
  isBuiltInObjectRef,
  isKnownBuiltInTypeName,
  markAlternativeRef,
  markExactKindRef,
  markExactSignatureRef,
  markExplicitSchemaRef,
  markImplicitProviderRef,
  markOmitIfNoLocalProducerRef,
  objectRefKey,
  SHELL_TYPE_SIGNATURE,
  splitQualifiedName,
} from "../model/object-ref.ts";
import type { AnnotationHints, Diagnostic, ObjectRef } from "../model/types.ts";
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
  diagnostics?: Diagnostic[];
};

type ExtractionContext = {
  createdTypeKeys: ReadonlySet<string>;
  enumTypeKeys: ReadonlySet<string>;
  rangeTypeKeys: ReadonlySet<string>;
  multirangeTypeKeys: ReadonlySet<string>;
  domainBaseTypes: ReadonlyMap<string, ObjectRef>;
  operatorFamilyKeys: ReadonlySet<string>;
  routineReturnProviders: readonly ObjectRef[];
};

const EMPTY_EXTRACTION_CONTEXT: ExtractionContext = {
  createdTypeKeys: new Set(),
  enumTypeKeys: new Set(),
  rangeTypeKeys: new Set(),
  multirangeTypeKeys: new Set(),
  domainBaseTypes: new Map(),
  operatorFamilyKeys: new Set(),
  routineReturnProviders: [],
};

const generatedArrayTypeName = (typeName: string): string =>
  clipPostgresIdentifier(`_${typeName}`);

const contextTypeKey = (typeRef: ObjectRef): string =>
  objectRefKey(
    createObjectRefFromAst(
      "type",
      typeRef.name,
      typeRef.schema ?? DEFAULT_SCHEMA,
    ),
  );

const generatedArrayTypeRef = (typeRef: ObjectRef): ObjectRef =>
  createObjectRefFromAst(
    "type",
    generatedArrayTypeName(typeRef.name),
    typeRef.schema,
  );

const hasCreatedType = (
  context: ExtractionContext,
  typeRef: ObjectRef,
): boolean => context.createdTypeKeys.has(contextTypeKey(typeRef));

const generatedArrayElementTypeRef = (typeRef: ObjectRef): ObjectRef | null => {
  if (!typeRef.name.startsWith("_") || typeRef.name.length <= 1) {
    return null;
  }
  return createObjectRefFromAst("type", typeRef.name.slice(1), typeRef.schema);
};

const typeRefMatchesGeneratedArrayTypeName = (
  typeRef: ObjectRef | null,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  if (!typeRef || typeRef.kind !== "type" || hasCreatedType(context, typeRef)) {
    return false;
  }
  const elementRef = generatedArrayElementTypeRef(typeRef);
  return elementRef !== null && hasCreatedType(context, elementRef);
};

const implicitArrayCollisionRequirement = (
  typeRef: ObjectRef,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ObjectRef | null => {
  const generatedRef = generatedArrayTypeRef(typeRef);
  return hasCreatedType(context, generatedRef) ? generatedRef : null;
};

const typeProviderRefs = (
  typeRef: ObjectRef,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ObjectRef[] => {
  const refs = [
    createObjectRefFromAst("type", typeRef.name, typeRef.schema),
    createObjectRefFromAst("type", `${typeRef.name}[]`, typeRef.schema),
  ];
  const generatedRef = generatedArrayTypeRef(typeRef);
  if (!hasCreatedType(context, generatedRef)) {
    refs.push(generatedRef);
  }
  return refs;
};

const addImplicitArrayCollisionDependency = (
  typeRef: ObjectRef,
  requires: ObjectRef[],
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): void => {
  const collisionRef = implicitArrayCollisionRequirement(typeRef, context);
  if (collisionRef) {
    requires.push(collisionRef);
  }
};

const relationRowTypeRef = (relationRef: ObjectRef): ObjectRef =>
  createObjectRefFromAst("type", relationRef.name, relationRef.schema);

const relationRowTypeProviderRefs = (
  relationRef: ObjectRef,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ObjectRef[] => typeProviderRefs(relationRowTypeRef(relationRef), context);

const addRelationRowTypeCollisionDependency = (
  relationRef: ObjectRef,
  requires: ObjectRef[],
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): void => {
  addImplicitArrayCollisionDependency(
    relationRowTypeRef(relationRef),
    requires,
    context,
  );
};

const isSelfTypeReference = (
  createdTypeRef: ObjectRef,
  requiredTypeRef: ObjectRef,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  if (requiredTypeRef.kind !== "type") {
    return false;
  }
  if (
    requiredTypeRef.explicitSchema !== true &&
    isBuiltInObjectRef(requiredTypeRef)
  ) {
    return false;
  }
  return (
    requiredTypeRef.schema === createdTypeRef.schema &&
    (requiredTypeRef.name === createdTypeRef.name ||
      requiredTypeRef.name === `${createdTypeRef.name}[]` ||
      (requiredTypeRef.name === generatedArrayTypeName(createdTypeRef.name) &&
        !hasCreatedType(context, requiredTypeRef)))
  );
};

const extractCreateTableDependencies = (
  statementNode: Record<string, unknown>,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const diagnostics: Diagnostic[] = [];
  const relation = asRecord(statementNode.relation);
  const tableRef = relationFromRangeVarNode(relation, "table");
  if (tableRef) {
    provides.push(tableRef);
    provides.push(...relationRowTypeProviderRefs(tableRef, context));
    addRelationRowTypeCollisionDependency(tableRef, requires, context);
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
        if (tableRef && isSelfTypeReference(tableRef, typeRef, context)) {
          diagnostics.push(
            selfReferenceDiagnostic(
              typeRef,
              `Table '${tableRef.schema ? `${tableRef.schema}.` : ""}${tableRef.name}' cannot reference its own row type before it exists.`,
            ),
          );
        }
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

  return { provides, requires, diagnostics };
};

const extractCreateTableAsDependencies = (
  statementNode: Record<string, unknown>,
  kind: "table" | "materialized_view",
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
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
    if (kind === "table" || kind === "materialized_view") {
      provides.push(...relationRowTypeProviderRefs(relationRef, context));
      addRelationRowTypeCollisionDependency(relationRef, requires, context);
    }
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
  const outputArgTypes: ObjectRef[] = [];

  for (const parameterNode of parameters) {
    const functionParameter = asRecord(
      asRecord(parameterNode)?.FunctionParameter,
    );
    const parameterMode =
      typeof functionParameter?.mode === "string"
        ? functionParameter.mode.toUpperCase()
        : "";
    const isOutOnlyParameter =
      parameterMode === "FUNC_PARAM_OUT" ||
      parameterMode === "FUNC_PARAM_TABLE";
    const isOutputParameter =
      isOutOnlyParameter || parameterMode === "FUNC_PARAM_INOUT";
    const argType = typeFromTypeNameNode(functionParameter?.argType);
    if (argType) {
      requires.push(argType);
      if (isOutputParameter) {
        outputArgTypes.push(argType);
      }
      if (isOutOnlyParameter) {
        continue;
      }
      signatureParts.push(typeSignaturePart(argType));
    } else if (!isOutOnlyParameter) {
      signatureParts.push("unknown");
    }
  }

  const functionRef = objectFromNameParts(kind, functionNameParts);
  const explicitReturnType = typeFromTypeNameNode(statementNode.returnType);
  const returnsSet = asRecord(statementNode.returnType)?.setof === true;
  const returnType =
    explicitReturnType ??
    (outputArgTypes.length === 1
      ? (outputArgTypes[0] ?? null)
      : outputArgTypes.length > 1
        ? createObjectRefFromAst("type", "record")
        : null);
  if (functionRef) {
    const argSignature = `(${signatureParts.join(",")})`;
    provides.push(
      createObjectRefFromAst(
        kind,
        functionRef.name,
        functionRef.schema,
        argSignature,
      ),
    );
    if (returnType && !returnsSet) {
      provides.push(
        createObjectRefFromAst(
          kind,
          functionRef.name,
          functionRef.schema,
          `${argSignature}->${typeSignaturePart(returnType)}`,
        ),
      );
    }
    if (functionRef.schema) {
      requires.push(createObjectRefFromAst("schema", functionRef.schema));
    }
  }

  if (returnType) {
    requires.push(returnType);
  }

  addRoutineBodyDependencies(statementNode, requires);

  return { provides, requires };
};

const extractViewDependencies = (
  statementNode: Record<string, unknown>,
  kind: "view" | "materialized_view",
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const viewRelation = asRecord(statementNode.view);
  const tableRef = relationFromRangeVarNode(viewRelation, "table");
  if (tableRef) {
    provides.push(createObjectRefFromAst(kind, tableRef.name, tableRef.schema));
    provides.push(...relationRowTypeProviderRefs(tableRef, context));
    addRelationRowTypeCollisionDependency(tableRef, requires, context);
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

  const grantees = Array.isArray(statementNode.grantees)
    ? statementNode.grantees
    : [];
  for (const granteeNode of grantees) {
    const roleSpec = asRecord(asRecord(granteeNode)?.RoleSpec);
    const roleName = roleNameFromRoleSpec(roleSpec);
    if (roleName) {
      requires.push(createObjectRefFromAst("role", roleName));
    }
  }

  return { provides, requires };
};

const accessMethodFromSignature = (signature?: string): string => {
  const trimmed = signature?.trim();
  if (!trimmed?.startsWith("(") || !trimmed.endsWith(")")) {
    return "";
  }
  return trimmed.slice(1, -1).split(",")[0]?.trim().toLowerCase() ?? "";
};

const isUnqualifiedBuiltInOperatorAccessMethodObject = (
  objectRef: ObjectRef,
): boolean => {
  if (
    objectRef.explicitSchema === true ||
    objectRef.schema !== DEFAULT_SCHEMA ||
    (objectRef.kind !== "operator_class" &&
      objectRef.kind !== "operator_family")
  ) {
    return false;
  }

  const accessMethod = accessMethodFromSignature(objectRef.signature);
  if (!accessMethod) {
    return false;
  }

  if (objectRef.kind === "operator_family") {
    return (
      builtInOperatorFamilyNamesForAccessMethod(accessMethod)?.has(
        objectRef.name.toLowerCase(),
      ) === true
    );
  }

  return (
    accessMethod === "btree" &&
    builtInRangeOperatorClassNames.has(objectRef.name.toLowerCase())
  );
};

const normalizeNamedObjectRequirement = (objectRef: ObjectRef): ObjectRef =>
  isUnqualifiedBuiltInOperatorAccessMethodObject(objectRef)
    ? markOmitIfNoLocalProducerRef(objectRef)
    : objectRef;

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
    requires: objectRef ? [normalizeNamedObjectRequirement(objectRef)] : [],
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
      requires.push(normalizeNamedObjectRequirement(objectRef));
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

const rangeFunctionOptionNames = new Set(["canonical", "subtype_diff"]);

const isBuiltInSchemaName = (schemaName: string): boolean => {
  const normalized = schemaName.toLowerCase();
  return normalized === "pg_catalog" || normalized === "information_schema";
};

const builtInRangeSupportFunctionSignatures = new Map<string, string[][]>([
  ["daterange_subdiff", [["date", "date"]]],
  ["float8mi", [["float8", "float8"]]],
  ["int4range_subdiff", [["int4", "int4"]]],
  ["int8range_subdiff", [["int8", "int8"]]],
  ["numrange_subdiff", [["numeric", "numeric"]]],
  ["tsrange_subdiff", [["timestamp", "timestamp"]]],
  ["tstzrange_subdiff", [["timestamptz", "timestamptz"]]],
]);

// PostgreSQL standard/predefined collations live in pg_catalog. User collations
// with the same name still need a dependency when explicitly schema-qualified.
const builtInRangeCollationNames = new Set([
  "c",
  "default",
  "pg_c_utf8",
  "pg_unicode_fast",
  "posix",
  "ucs_basic",
  "unicode",
]);

const isBuiltInRangeCollationName = (nameParts: string[]): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInRangeCollationNames.has(name)) {
    return false;
  }

  if (nameParts.length === 1) {
    return true;
  }

  return nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog";
};

const isPgCatalogQualifiedName = (nameParts: string[]): boolean =>
  nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog";

const isPgCatalogRef = (ref: ObjectRef | null | undefined): boolean =>
  ref?.schema?.toLowerCase() === "pg_catalog";

const catalogArrayElementName = (
  ref: ObjectRef | null | undefined,
): string | null => {
  if (
    !isPgCatalogRef(ref) ||
    ref?.kind !== "type" ||
    !ref.name.startsWith("_")
  ) {
    return null;
  }
  return ref.name.slice(1);
};

const isKnownPgCatalogTypeRef = (
  ref: ObjectRef | null | undefined,
): boolean => {
  if (!isPgCatalogRef(ref) || ref?.kind !== "type") {
    return false;
  }
  const elementName = catalogArrayElementName(ref);
  return (
    isKnownBuiltInTypeName(ref.name) ||
    (elementName !== null && isKnownBuiltInTypeName(elementName))
  );
};

const unresolvedCatalogDiagnostic = (
  message: string,
  objectRef: ObjectRef,
  suggestedFix: string,
): Diagnostic => ({
  code: "UNRESOLVED_DEPENDENCY",
  message,
  objectRefs: [objectRef],
  suggestedFix,
});

const selfReferenceDiagnostic = (
  objectRef: ObjectRef,
  message: string,
): Diagnostic => ({
  code: "UNRESOLVED_DEPENDENCY",
  message,
  objectRefs: [objectRef],
  suggestedFix:
    "Create the referenced type in a separate earlier statement or use a different existing type.",
});

// Common pg_catalog btree operator classes that can be used as range
// SUBTYPE_OPCLASS values without an input CREATE OPERATOR CLASS statement.
const builtInRangeOperatorClassNames = new Set([
  "array_ops",
  "bit_ops",
  "bool_ops",
  "bpchar_ops",
  "bpchar_pattern_ops",
  "bytea_ops",
  "char_ops",
  "cidr_ops",
  "date_ops",
  "enum_ops",
  "float4_ops",
  "float8_ops",
  "inet_ops",
  "int2_ops",
  "int4_ops",
  "int8_ops",
  "interval_ops",
  "jsonb_ops",
  "macaddr8_ops",
  "macaddr_ops",
  "money_ops",
  "name_ops",
  "numeric_ops",
  "oid_ops",
  "oidvector_ops",
  "pg_lsn_ops",
  "record_image_ops",
  "record_ops",
  "range_ops",
  "multirange_ops",
  "text_ops",
  "text_pattern_ops",
  "tid_ops",
  "time_ops",
  "timestamp_ops",
  "timestamptz_ops",
  "timetz_ops",
  "tsquery_ops",
  "tsvector_ops",
  "uuid_ops",
  "varbit_ops",
  "varchar_ops",
  "varchar_pattern_ops",
  "xid8_ops",
]);

const builtInRangeOperatorClassSubtypes = new Map<string, string[]>([
  ["bit_ops", ["bit"]],
  ["bool_ops", ["bool"]],
  ["bpchar_ops", ["bpchar"]],
  ["bpchar_pattern_ops", ["bpchar"]],
  ["bytea_ops", ["bytea"]],
  ["char_ops", ["char"]],
  ["cidr_ops", ["cidr", "inet"]],
  ["date_ops", ["date"]],
  ["float4_ops", ["float4"]],
  ["float8_ops", ["float8"]],
  ["inet_ops", ["inet"]],
  ["int2_ops", ["int2"]],
  ["int4_ops", ["int4"]],
  ["int8_ops", ["int8"]],
  ["interval_ops", ["interval"]],
  ["jsonb_ops", ["jsonb"]],
  ["macaddr8_ops", ["macaddr8"]],
  ["macaddr_ops", ["macaddr"]],
  ["money_ops", ["money"]],
  ["name_ops", ["name"]],
  ["numeric_ops", ["numeric"]],
  ["oid_ops", ["oid"]],
  ["oidvector_ops", ["oidvector"]],
  ["pg_lsn_ops", ["pg_lsn"]],
  ["record_image_ops", ["record"]],
  ["record_ops", ["record"]],
  ["text_ops", ["text"]],
  ["text_pattern_ops", ["text"]],
  ["tid_ops", ["tid"]],
  ["time_ops", ["time"]],
  ["timestamp_ops", ["timestamp"]],
  ["timestamptz_ops", ["timestamptz"]],
  ["timetz_ops", ["timetz"]],
  ["tsquery_ops", ["tsquery"]],
  ["tsvector_ops", ["tsvector"]],
  ["uuid_ops", ["uuid"]],
  ["varbit_ops", ["varbit"]],
  ["varchar_ops", ["varchar"]],
  ["varchar_pattern_ops", ["varchar"]],
  ["xid8_ops", ["xid8"]],
]);

const binaryCoercibleRangeOperatorClassSubtypes = new Map<string, string[]>([
  ["inet_ops", ["cidr"]],
  ["text_ops", ["varchar"]],
  ["text_pattern_ops", ["varchar"]],
]);

const typeRefMatchesBuiltInNames = (
  typeRef: ObjectRef | null,
  names: string[],
): boolean => {
  if (!typeRef || typeRef.kind !== "type") {
    return false;
  }
  return (
    isBuiltInObjectRef(typeRef) && names.includes(typeRef.name.toLowerCase())
  );
};

const typeRefMatchesCatalogArrayTypeName = (
  typeRef: ObjectRef | null,
): boolean => {
  const elementName = catalogArrayElementName(typeRef);
  return elementName !== null && isKnownBuiltInTypeName(elementName);
};

const isBuiltInRangeSupportFunctionName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name) {
    return false;
  }
  const builtInSignatures = builtInRangeSupportFunctionSignatures.get(name);
  if (!builtInSignatures) {
    return false;
  }
  if (
    nameParts.length !== 1 &&
    !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  ) {
    return false;
  }

  return builtInSignatures.some(
    (signature) =>
      args.length === signature.length &&
      signature.every((typeName, index) =>
        typeRefMatchesBuiltInNames(args[index] ?? null, [typeName]),
      ),
  );
};

const polymorphicBuiltInTypeNames = new Set([
  "any",
  "anyarray",
  "anycompatible",
  "anycompatiblearray",
  "anycompatiblenonarray",
  "anycompatiblemultirange",
  "anycompatiblerange",
  "anyelement",
  "anyenum",
  "anymultirange",
  "anynonarray",
  "anyrange",
]);

const normalizedTypeContextKey = (typeRef: ObjectRef): string =>
  objectRefKey(
    createObjectRefFromAst(
      "type",
      typeRef.name,
      typeRef.schema ?? DEFAULT_SCHEMA,
    ),
  );

const typeRefMatchesPolymorphicBuiltInName = (
  typeRef: ObjectRef | null,
  typeName: string,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  if (!typeRef || typeRef.kind !== "type") {
    return false;
  }

  const normalizedTypeName = typeName.toLowerCase();
  const normalizedRefName = typeRef.name.toLowerCase();
  const typeKey = normalizedTypeContextKey(typeRef);
  if (
    normalizedTypeName === "anyarray" ||
    normalizedTypeName === "anycompatiblearray"
  ) {
    return (
      normalizedRefName === normalizedTypeName ||
      normalizedRefName.endsWith("[]") ||
      typeRefMatchesCatalogArrayTypeName(typeRef) ||
      typeRefMatchesGeneratedArrayTypeName(typeRef, context)
    );
  }
  if (normalizedTypeName === "anyenum") {
    return context.enumTypeKeys.has(typeKey);
  }
  if (
    normalizedTypeName === "anyrange" ||
    normalizedTypeName === "anycompatiblerange"
  ) {
    return (
      typeRefMatchesBuiltInNames(typeRef, [
        "daterange",
        "int4range",
        "int8range",
        "numrange",
        "tsrange",
        "tstzrange",
      ]) || context.rangeTypeKeys.has(typeKey)
    );
  }
  if (
    normalizedTypeName === "anymultirange" ||
    normalizedTypeName === "anycompatiblemultirange"
  ) {
    return (
      typeRefMatchesBuiltInNames(typeRef, [
        "datemultirange",
        "int4multirange",
        "int8multirange",
        "nummultirange",
        "tsmultirange",
        "tstzmultirange",
      ]) || context.multirangeTypeKeys.has(typeKey)
    );
  }
  if (
    normalizedTypeName === "anynonarray" ||
    normalizedTypeName === "anycompatiblenonarray"
  ) {
    return (
      !normalizedRefName.endsWith("[]") &&
      !typeRefMatchesCatalogArrayTypeName(typeRef) &&
      !typeRefMatchesGeneratedArrayTypeName(typeRef, context)
    );
  }

  return polymorphicBuiltInTypeNames.has(normalizedTypeName);
};

const typeRefMatchesBuiltInSupportTypeName = (
  typeRef: ObjectRef | null,
  typeName: string,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean =>
  polymorphicBuiltInTypeNames.has(typeName.toLowerCase())
    ? typeRefMatchesPolymorphicBuiltInName(typeRef, typeName, context)
    : typeRefMatchesBuiltInNames(typeRef, [typeName]);

const isBuiltInRangeOperatorClassName = (
  nameParts: string[],
  subtypeRef: ObjectRef | null,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInRangeOperatorClassNames.has(name)) {
    return false;
  }

  if (nameParts.length !== 1 && !isPgCatalogQualifiedName(nameParts)) {
    return false;
  }

  const expectedSubtypes = builtInRangeOperatorClassSubtypes.get(name);
  if (!expectedSubtypes) {
    if (name === "array_ops") {
      return typeRefMatchesPolymorphicBuiltInName(
        subtypeRef,
        "anyarray",
        context,
      );
    }
    if (name === "enum_ops") {
      return typeRefMatchesPolymorphicBuiltInName(
        subtypeRef,
        "anyenum",
        context,
      );
    }
    if (name === "range_ops") {
      return typeRefMatchesPolymorphicBuiltInName(
        subtypeRef,
        "anyrange",
        context,
      );
    }
    if (name === "multirange_ops") {
      return typeRefMatchesPolymorphicBuiltInName(
        subtypeRef,
        "anymultirange",
        context,
      );
    }
    return true;
  }

  // Some user-defined opclasses intentionally reuse built-in names. Only skip
  // concrete built-in names when the range subtype is compatible with the
  // pg_catalog opclass input type.
  return typeRefMatchesBuiltInNames(subtypeRef, [
    ...expectedSubtypes,
    ...(binaryCoercibleRangeOperatorClassSubtypes.get(name) ?? []),
  ]);
};

const builtInBtreeOperatorFamilyNames = new Set([
  "array_ops",
  "bit_ops",
  "bool_ops",
  "bpchar_ops",
  "bpchar_pattern_ops",
  "bytea_ops",
  "char_ops",
  "datetime_ops",
  "enum_ops",
  "float_ops",
  "integer_ops",
  "interval_ops",
  "jsonb_ops",
  "macaddr8_ops",
  "macaddr_ops",
  "money_ops",
  "name_ops",
  "multirange_ops",
  "network_ops",
  "numeric_ops",
  "oid_ops",
  "oidvector_ops",
  "pg_lsn_ops",
  "range_ops",
  "record_image_ops",
  "record_ops",
  "text_ops",
  "text_pattern_ops",
  "tid_ops",
  "time_ops",
  "timetz_ops",
  "tsquery_ops",
  "tsvector_ops",
  "uuid_ops",
  "varbit_ops",
  "xid8_ops",
]);

const builtInOrderByOperatorFamilyReturnTypes = new Map([
  ["float_ops", "float8"],
  ["integer_ops", "int4"],
  ["numeric_ops", "numeric"],
]);

const orderByOperatorReturnType = (
  orderFamilyNameParts: string[],
  orderFamilyRef: ObjectRef | null,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ObjectRef | null => {
  const name = orderFamilyNameParts.at(-1)?.toLowerCase();
  if (
    !name ||
    (!isBuiltInBtreeOperatorFamilyName(orderFamilyNameParts) &&
      !isUnqualifiedBuiltInBtreeOperatorFamilyName(orderFamilyNameParts))
  ) {
    return null;
  }
  if (
    orderFamilyNameParts.length === 1 &&
    orderFamilyRef &&
    context.operatorFamilyKeys.has(
      operatorFamilyContextKey(orderFamilyRef, "btree"),
    )
  ) {
    return null;
  }

  const returnTypeName = builtInOrderByOperatorFamilyReturnTypes.get(name);
  return returnTypeName ? createObjectRefFromAst("type", returnTypeName) : null;
};

const builtInHashOperatorFamilyNames = new Set([
  "aclitem_ops",
  "array_ops",
  "bool_ops",
  "bpchar_ops",
  "bytea_ops",
  "char_ops",
  "cid_ops",
  "date_ops",
  "enum_ops",
  "float_ops",
  "integer_ops",
  "interval_ops",
  "jsonb_ops",
  "macaddr8_ops",
  "macaddr_ops",
  "multirange_ops",
  "name_ops",
  "network_ops",
  "numeric_ops",
  "oid_ops",
  "oidvector_ops",
  "pg_lsn_ops",
  "range_ops",
  "record_ops",
  "text_ops",
  "tid_ops",
  "time_ops",
  "timestamp_ops",
  "timestamptz_ops",
  "timetz_ops",
  "uuid_ops",
  "xid8_ops",
  "xid_ops",
]);

const builtInBrinOperatorFamilyNames = new Set([
  "bit_minmax_ops",
  "box_inclusion_ops",
  "bpchar_bloom_ops",
  "bpchar_minmax_ops",
  "bytea_bloom_ops",
  "bytea_minmax_ops",
  "char_bloom_ops",
  "char_minmax_ops",
  "datetime_bloom_ops",
  "datetime_minmax_multi_ops",
  "datetime_minmax_ops",
  "float_bloom_ops",
  "float_minmax_multi_ops",
  "float_minmax_ops",
  "integer_bloom_ops",
  "integer_minmax_multi_ops",
  "integer_minmax_ops",
  "interval_bloom_ops",
  "interval_minmax_multi_ops",
  "interval_minmax_ops",
  "macaddr8_bloom_ops",
  "macaddr8_minmax_multi_ops",
  "macaddr8_minmax_ops",
  "macaddr_bloom_ops",
  "macaddr_minmax_multi_ops",
  "macaddr_minmax_ops",
  "name_bloom_ops",
  "name_minmax_ops",
  "network_bloom_ops",
  "network_inclusion_ops",
  "network_minmax_multi_ops",
  "network_minmax_ops",
  "numeric_bloom_ops",
  "numeric_minmax_multi_ops",
  "numeric_minmax_ops",
  "oid_bloom_ops",
  "oid_minmax_multi_ops",
  "oid_minmax_ops",
  "pg_lsn_bloom_ops",
  "pg_lsn_minmax_multi_ops",
  "pg_lsn_minmax_ops",
  "range_inclusion_ops",
  "text_bloom_ops",
  "text_minmax_ops",
  "tid_bloom_ops",
  "tid_minmax_multi_ops",
  "tid_minmax_ops",
  "time_bloom_ops",
  "time_minmax_multi_ops",
  "time_minmax_ops",
  "timetz_bloom_ops",
  "timetz_minmax_multi_ops",
  "timetz_minmax_ops",
  "uuid_bloom_ops",
  "uuid_minmax_multi_ops",
  "uuid_minmax_ops",
  "varbit_minmax_ops",
]);

const builtInGinOperatorFamilyNames = new Set([
  "array_ops",
  "jsonb_ops",
  "jsonb_path_ops",
  "tsvector_ops",
]);

const builtInGistOperatorFamilyNames = new Set([
  "box_ops",
  "circle_ops",
  "inet_ops",
  "multirange_ops",
  "point_ops",
  "poly_ops",
  "range_ops",
  "tsquery_ops",
  "tsvector_ops",
]);

const builtInSpgistOperatorFamilyNames = new Set([
  "box_ops",
  "inet_ops",
  "kd_point_ops",
  "poly_ops",
  "quad_point_ops",
  "range_ops",
  "text_ops",
]);

const builtInOperatorFamilyNamesByAccessMethod = new Map([
  ["btree", builtInBtreeOperatorFamilyNames],
  ["hash", builtInHashOperatorFamilyNames],
  ["brin", builtInBrinOperatorFamilyNames],
  ["gin", builtInGinOperatorFamilyNames],
  ["gist", builtInGistOperatorFamilyNames],
  ["spgist", builtInSpgistOperatorFamilyNames],
]);

const builtInAccessMethodNames = new Set([
  "brin",
  "btree",
  "gin",
  "gist",
  "hash",
  "heap",
  "spgist",
]);

const builtInIndexAccessMethodNames = new Set([
  "brin",
  "btree",
  "gin",
  "gist",
  "hash",
  "spgist",
]);

const builtInTableAccessMethodNames = new Set(["heap"]);

type AccessMethodKind = "index" | "table";

const accessMethodSignature = (kind: AccessMethodKind): string => `(${kind})`;

const accessMethodKindFromAmType = (
  amtype: unknown,
): AccessMethodKind | null => {
  if (amtype === "i") {
    return "index";
  }
  if (amtype === "t") {
    return "table";
  }
  return null;
};

const isBuiltInAccessMethodForKind = (
  accessMethod: string,
  kind?: AccessMethodKind,
): boolean => {
  const normalizedAccessMethod = accessMethod.toLowerCase();
  if (!kind) {
    return builtInAccessMethodNames.has(normalizedAccessMethod);
  }
  if (kind === "index") {
    return builtInIndexAccessMethodNames.has(normalizedAccessMethod);
  }
  return builtInTableAccessMethodNames.has(normalizedAccessMethod);
};

const accessMethodRef = (
  accessMethod: string,
  kind?: AccessMethodKind,
): ObjectRef =>
  createObjectRefFromAst(
    "access_method",
    accessMethod,
    undefined,
    kind ? accessMethodSignature(kind) : undefined,
  );

const builtInIndexAccessMethodHandlerNames = new Set([
  "brinhandler",
  "bthandler",
  "ginhandler",
  "gisthandler",
  "hashhandler",
  "spghandler",
]);
const builtInTableAccessMethodHandlerNames = new Set(["heap_tableam_handler"]);

const isBuiltInAccessMethodHandlerName = (
  nameParts: string[],
  kind: AccessMethodKind | null,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || kind === null) {
    return false;
  }
  if (
    nameParts.length !== 1 &&
    !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  ) {
    return false;
  }

  return kind === "index"
    ? builtInIndexAccessMethodHandlerNames.has(name)
    : builtInTableAccessMethodHandlerNames.has(name);
};

const addAccessMethodDependencyIfNeeded = (
  accessMethod: string,
  requires: ObjectRef[],
  kind?: AccessMethodKind,
): void => {
  const normalizedAccessMethod = accessMethod.toLowerCase();
  if (
    normalizedAccessMethod.length === 0 ||
    isBuiltInAccessMethodForKind(normalizedAccessMethod, kind)
  ) {
    return;
  }

  requires.push(accessMethodRef(accessMethod, kind));
};

const builtInOperatorFamilyNamesForAccessMethod = (
  accessMethod: string,
): ReadonlySet<string> | undefined =>
  builtInOperatorFamilyNamesByAccessMethod.get(accessMethod.toLowerCase());

const isBuiltInBtreeOperatorFamilyName = (nameParts: string[]): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInBtreeOperatorFamilyNames.has(name)) {
    return false;
  }

  return nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog";
};

const isUnqualifiedBuiltInBtreeOperatorFamilyName = (
  nameParts: string[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  return (
    nameParts.length === 1 &&
    name !== undefined &&
    builtInBtreeOperatorFamilyNames.has(name)
  );
};

const isBuiltInOperatorFamilyNameForAccessMethod = (
  nameParts: string[],
  accessMethod: string,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name) {
    return false;
  }

  const builtInFamilyNames =
    builtInOperatorFamilyNamesForAccessMethod(accessMethod);
  return (
    builtInFamilyNames?.has(name) === true &&
    nameParts.length === 2 &&
    nameParts[0]?.toLowerCase() === "pg_catalog"
  );
};

const isUnqualifiedBuiltInOperatorFamilyNameForAccessMethod = (
  nameParts: string[],
  accessMethod: string,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || nameParts.length !== 1) {
    return false;
  }

  return (
    builtInOperatorFamilyNamesForAccessMethod(accessMethod)?.has(name) === true
  );
};

// Opclass items commonly reference pg_catalog support objects without schema
// qualification. Keep PostgreSQL's built-in btree support routines out of
// dependency resolution while still requiring user-defined unqualified support
// items such as <# or app.cmp(...).
const builtInOperatorClassSupportFunctionSignatures = new Map<
  string,
  string[][]
>([
  ["bitcmp", [["bit", "bit"]]],
  ["bpchar_sortsupport", [["internal"]]],
  ["bpcharcmp", [["bpchar", "bpchar"]]],
  ["btarraycmp", [["anyarray", "anyarray"]]],
  ["btboolcmp", [["bool", "bool"]]],
  ["btbpchar_pattern_cmp", [["bpchar", "bpchar"]]],
  ["btbpchar_pattern_sortsupport", [["internal"]]],
  ["brin_bloom_opcinfo", [["internal"]]],
  ["brin_inclusion_opcinfo", [["internal"]]],
  ["brin_minmax_opcinfo", [["internal"]]],
  ["brin_minmax_add_value", [["internal", "internal", "internal", "internal"]]],
  ["brin_minmax_consistent", [["internal", "internal", "internal"]]],
  ["brin_minmax_union", [["internal", "internal", "internal"]]],
  ["brin_minmax_multi_opcinfo", [["internal"]]],
  ["btcharcmp", [["char", "char"]]],
  ["btequalimage", [["oid"]]],
  ["btfloat4cmp", [["float4", "float4"]]],
  ["btfloat48cmp", [["float4", "float8"]]],
  ["btfloat4sortsupport", [["internal"]]],
  ["btfloat84cmp", [["float8", "float4"]]],
  ["btfloat8cmp", [["float8", "float8"]]],
  ["btfloat8sortsupport", [["internal"]]],
  ["btint24cmp", [["int2", "int4"]]],
  ["btint28cmp", [["int2", "int8"]]],
  ["btint2cmp", [["int2", "int2"]]],
  ["btint2sortsupport", [["internal"]]],
  ["btint42cmp", [["int4", "int2"]]],
  ["btint48cmp", [["int4", "int8"]]],
  ["btint4cmp", [["int4", "int4"]]],
  ["btint4sortsupport", [["internal"]]],
  ["btint82cmp", [["int8", "int2"]]],
  ["btint84cmp", [["int8", "int4"]]],
  ["btint8cmp", [["int8", "int8"]]],
  ["btint8sortsupport", [["internal"]]],
  ["btnamecmp", [["name", "name"]]],
  ["btnamesortsupport", [["internal"]]],
  ["btoidcmp", [["oid", "oid"]]],
  ["btoidsortsupport", [["internal"]]],
  ["btoidvectorcmp", [["oidvector", "oidvector"]]],
  ["btrecordcmp", [["record", "record"]]],
  ["btrecordimagecmp", [["record", "record"]]],
  ["bttext_pattern_cmp", [["text", "text"]]],
  ["bttext_pattern_sortsupport", [["internal"]]],
  ["bttextcmp", [["text", "text"]]],
  ["bttextsortsupport", [["internal"]]],
  ["bttidcmp", [["tid", "tid"]]],
  ["btvarstrequalimage", [["oid"]]],
  ["bytea_sortsupport", [["internal"]]],
  ["byteacmp", [["bytea", "bytea"]]],
  ["cash_cmp", [["money", "money"]]],
  ["date_cmp", [["date", "date"]]],
  ["date_sortsupport", [["internal"]]],
  ["enum_cmp", [["anyenum", "anyenum"]]],
  ["gist_box_consistent", [["internal", "box", "int2", "oid", "internal"]]],
  [
    "ginarrayconsistent",
    [
      [
        "internal",
        "int2",
        "anyarray",
        "int4",
        "internal",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  ["ginarrayextract", [["anyarray", "internal", "internal"]]],
  ["gin_compare_jsonb", [["text", "text"]]],
  [
    "gin_consistent_jsonb",
    [
      [
        "internal",
        "int2",
        "jsonb",
        "int4",
        "internal",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  [
    "gin_consistent_jsonb_path",
    [
      [
        "internal",
        "int2",
        "jsonb",
        "int4",
        "internal",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  ["gin_extract_jsonb", [["jsonb", "internal", "internal"]]],
  ["gin_extract_jsonb_path", [["jsonb", "internal", "internal"]]],
  [
    "gin_extract_jsonb_query",
    [
      [
        "jsonb",
        "internal",
        "int2",
        "internal",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  [
    "gin_extract_jsonb_query_path",
    [
      [
        "jsonb",
        "internal",
        "int2",
        "internal",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  [
    "ginarraytriconsistent",
    [
      [
        "internal",
        "int2",
        "anyarray",
        "int4",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  [
    "gin_triconsistent_jsonb",
    [["internal", "int2", "jsonb", "int4", "internal", "internal", "internal"]],
  ],
  [
    "gin_triconsistent_jsonb_path",
    [["internal", "int2", "jsonb", "int4", "internal", "internal", "internal"]],
  ],
  [
    "ginqueryarrayextract",
    [
      [
        "anyarray",
        "internal",
        "int2",
        "internal",
        "internal",
        "internal",
        "internal",
      ],
    ],
  ],
  ["hash_aclitem", [["aclitem"]]],
  ["hash_aclitem_extended", [["aclitem", "int8"]]],
  ["hash_array", [["anyarray"]]],
  ["hash_array_extended", [["anyarray", "int8"]]],
  ["hashcid", [["cid"]]],
  ["hashcidextended", [["cid", "int8"]]],
  ["hash_multirange", [["anymultirange"]]],
  ["hash_multirange_extended", [["anymultirange", "int8"]]],
  ["hash_numeric", [["numeric"]]],
  ["hash_numeric_extended", [["numeric", "int8"]]],
  ["hash_range", [["anyrange"]]],
  ["hash_range_extended", [["anyrange", "int8"]]],
  ["hash_record", [["record"]]],
  ["hash_record_extended", [["record", "int8"]]],
  ["hashbpchar", [["bpchar"]]],
  ["hashbpcharextended", [["bpchar", "int8"]]],
  ["hashchar", [["char"]]],
  ["hashcharextended", [["char", "int8"]]],
  ["hashenum", [["anyenum"]]],
  ["hashenumextended", [["anyenum", "int8"]]],
  ["hashfloat4", [["float4"]]],
  ["hashfloat4extended", [["float4", "int8"]]],
  ["hashfloat8", [["float8"]]],
  ["hashfloat8extended", [["float8", "int8"]]],
  ["hashinet", [["inet"]]],
  ["hashinetextended", [["inet", "int8"]]],
  ["hashint2", [["int2"]]],
  ["hashint2extended", [["int2", "int8"]]],
  ["hashint4", [["int4"]]],
  ["hashint4extended", [["int4", "int8"]]],
  ["hashint8", [["int8"]]],
  ["hashint8extended", [["int8", "int8"]]],
  ["hashmacaddr", [["macaddr"]]],
  ["hashmacaddrextended", [["macaddr", "int8"]]],
  ["hashmacaddr8", [["macaddr8"]]],
  ["hashmacaddr8extended", [["macaddr8", "int8"]]],
  ["hashname", [["name"]]],
  ["hashnameextended", [["name", "int8"]]],
  ["hashoid", [["oid"]]],
  ["hashoidextended", [["oid", "int8"]]],
  ["hashoidvector", [["oidvector"]]],
  ["hashoidvectorextended", [["oidvector", "int8"]]],
  ["hashtext", [["text"]]],
  ["hashtextextended", [["text", "int8"]]],
  ["hashtid", [["tid"]]],
  ["hashtidextended", [["tid", "int8"]]],
  ["hashvarlena", [["internal"]]],
  ["hashvarlenaextended", [["internal", "int8"]]],
  ["hashxid", [["xid"]]],
  ["hashxidextended", [["xid", "int8"]]],
  [
    "in_range",
    [
      ["float8", "float8", "float8", "bool", "bool"],
      ["float4", "float4", "float8", "bool", "bool"],
      ["date", "date", "interval", "bool", "bool"],
      ["int2", "int2", "int2", "bool", "bool"],
      ["int2", "int2", "int4", "bool", "bool"],
      ["int2", "int2", "int8", "bool", "bool"],
      ["int4", "int4", "int4", "bool", "bool"],
      ["int4", "int4", "int2", "bool", "bool"],
      ["int4", "int4", "int8", "bool", "bool"],
      ["int8", "int8", "int8", "bool", "bool"],
      ["interval", "interval", "interval", "bool", "bool"],
      ["numeric", "numeric", "numeric", "bool", "bool"],
      ["time", "time", "interval", "bool", "bool"],
      ["timetz", "timetz", "interval", "bool", "bool"],
      ["timestamp", "timestamp", "interval", "bool", "bool"],
      ["timestamptz", "timestamptz", "interval", "bool", "bool"],
    ],
  ],
  ["interval_cmp", [["interval", "interval"]]],
  ["interval_hash", [["interval"]]],
  ["interval_hash_extended", [["interval", "int8"]]],
  ["jsonb_cmp", [["jsonb", "jsonb"]]],
  ["jsonb_hash", [["jsonb"]]],
  ["jsonb_hash_extended", [["jsonb", "int8"]]],
  ["macaddr8_cmp", [["macaddr8", "macaddr8"]]],
  ["macaddr_cmp", [["macaddr", "macaddr"]]],
  ["macaddr_sortsupport", [["internal"]]],
  ["multirange_cmp", [["anymultirange", "anymultirange"]]],
  ["network_cmp", [["inet", "inet"]]],
  ["network_sortsupport", [["internal"]]],
  ["numeric_cmp", [["numeric", "numeric"]]],
  ["numeric_sortsupport", [["internal"]]],
  ["pg_lsn_cmp", [["pg_lsn", "pg_lsn"]]],
  ["pg_lsn_hash", [["pg_lsn"]]],
  ["pg_lsn_hash_extended", [["pg_lsn", "int8"]]],
  ["range_cmp", [["anyrange", "anyrange"]]],
  ["spg_text_choose", [["internal", "internal"]]],
  ["spg_text_config", [["internal", "internal"]]],
  ["spg_text_inner_consistent", [["internal", "internal"]]],
  ["spg_text_leaf_consistent", [["internal", "internal"]]],
  ["spg_text_picksplit", [["internal", "internal"]]],
  ["time_cmp", [["time", "time"]]],
  ["time_hash", [["time"]]],
  ["time_hash_extended", [["time", "int8"]]],
  ["timestamp_cmp", [["timestamp", "timestamp"]]],
  ["timestamp_hash", [["timestamp"]]],
  ["timestamp_hash_extended", [["timestamp", "int8"]]],
  ["timestamp_sortsupport", [["internal"]]],
  ["timestamptz_cmp", [["timestamptz", "timestamptz"]]],
  ["timetz_cmp", [["timetz", "timetz"]]],
  ["timetz_hash", [["timetz"]]],
  ["timetz_hash_extended", [["timetz", "int8"]]],
  ["tsquery_cmp", [["tsquery", "tsquery"]]],
  ["tsvector_cmp", [["tsvector", "tsvector"]]],
  ["uuid_cmp", [["uuid", "uuid"]]],
  ["uuid_hash", [["uuid"]]],
  ["uuid_hash_extended", [["uuid", "int8"]]],
  ["uuid_sortsupport", [["internal"]]],
  ["varbitcmp", [["varbit", "varbit"]]],
  ["xid8cmp", [["xid8", "xid8"]]],
]);

const isHashSupportFunctionName = (name: string): boolean =>
  name.startsWith("hash") || name.includes("_hash");

const isHashExtendedSupportFunctionName = (name: string): boolean =>
  isHashSupportFunctionName(name) && name.endsWith("extended");

const builtInBrinSupportFunctionNames = new Set([
  "brin_bloom_opcinfo",
  "brin_inclusion_opcinfo",
  "brin_minmax_opcinfo",
  "brin_minmax_add_value",
  "brin_minmax_consistent",
  "brin_minmax_union",
  "brin_minmax_multi_opcinfo",
]);

const builtInBtreeSkipSupportFunctionNames = new Set([
  "btint2skipsupport",
  "btint4skipsupport",
  "btint8skipsupport",
  "btoidskipsupport",
]);

const isBuiltInBtreeSkipSupportFunctionName = (
  name: string,
  signature: string[],
): boolean =>
  builtInBtreeSkipSupportFunctionNames.has(name) &&
  signature.length === 1 &&
  signature[0] === "internal";

const builtInOperatorClassSupportFunctionMatchesSlot = (
  name: string,
  signature: string[],
  accessMethod: string,
  supportNumber: number,
): boolean => {
  const normalizedAccessMethod = accessMethod.toLowerCase();

  if (normalizedAccessMethod === "btree") {
    if (supportNumber === 1) {
      return (
        signature.length === 2 &&
        name !== "in_range" &&
        !name.endsWith("sortsupport") &&
        !isHashSupportFunctionName(name)
      );
    }

    if (supportNumber === 2) {
      return (
        signature.length === 1 &&
        signature[0] === "internal" &&
        name.endsWith("sortsupport")
      );
    }

    if (supportNumber === 3) {
      return name === "in_range";
    }

    if (supportNumber === 4) {
      return (
        signature.length === 1 &&
        signature[0] === "oid" &&
        (name === "btequalimage" || name === "btvarstrequalimage")
      );
    }

    if (supportNumber === 6) {
      return isBuiltInBtreeSkipSupportFunctionName(name, signature);
    }
  }

  if (normalizedAccessMethod === "hash") {
    if (supportNumber === 1) {
      return (
        signature.length === 1 &&
        !name.endsWith("sortsupport") &&
        name !== "btequalimage" &&
        name !== "btvarstrequalimage" &&
        name !== "in_range"
      );
    }

    if (supportNumber === 2) {
      return (
        signature.length === 2 &&
        signature[1] === "int8" &&
        isHashExtendedSupportFunctionName(name)
      );
    }
  }

  if (normalizedAccessMethod === "brin") {
    if (supportNumber === 1) {
      return (
        signature.length === 1 &&
        signature[0] === "internal" &&
        builtInBrinSupportFunctionNames.has(name)
      );
    }

    if (supportNumber === 2) {
      return (
        name === "brin_minmax_add_value" &&
        signature.length === 4 &&
        signature.every((type) => type === "internal")
      );
    }

    if (supportNumber === 3) {
      return (
        name === "brin_minmax_consistent" &&
        signature.length === 3 &&
        signature.every((type) => type === "internal")
      );
    }

    if (supportNumber === 4) {
      return (
        name === "brin_minmax_union" &&
        signature.length === 3 &&
        signature.every((type) => type === "internal")
      );
    }
  }

  if (normalizedAccessMethod === "gist") {
    if (supportNumber === 1 || supportNumber === 8) {
      return signature.length === 5 && signature[0] === "internal";
    }

    if ([2, 6].includes(supportNumber)) {
      return signature.length === 2 && signature[0] === "internal";
    }

    if (supportNumber === 5) {
      return (
        signature.length === 3 && signature.every((type) => type === "internal")
      );
    }

    if (supportNumber === 7) {
      return signature.length === 3 && signature[2] === "internal";
    }

    if ([3, 4, 9, 10, 11].includes(supportNumber)) {
      return signature.length === 1 && signature[0] === "internal";
    }
  }

  if (normalizedAccessMethod === "gin") {
    if (supportNumber === 1) {
      return signature.length === 2;
    }

    if (supportNumber === 2) {
      return signature.length === 3 && signature[1] === "internal";
    }

    if (supportNumber === 3) {
      return signature.length === 7 && signature[1] === "internal";
    }

    if (supportNumber === 4) {
      return signature.length === 8 && signature[0] === "internal";
    }

    if (supportNumber === 5) {
      return signature.length === 4;
    }

    if (supportNumber === 6) {
      return signature.length === 7 && signature[0] === "internal";
    }

    if (supportNumber === 7) {
      return signature.length === 1 && signature[0] === "internal";
    }
  }

  if (normalizedAccessMethod === "spgist") {
    if ([1, 2, 3, 4, 5].includes(supportNumber)) {
      return (
        signature.length === 2 && signature.every((type) => type === "internal")
      );
    }

    if (supportNumber === 6) {
      return signature.length === 1;
    }

    if (supportNumber === 7) {
      return signature.length === 1 && signature[0] === "internal";
    }
  }

  return false;
};

const builtInOperatorClassSupportFunctionMatchesTypes = (
  signature: string[],
  accessMethod: string,
  supportNumber: number,
  operatorClassDataTypeRef: ObjectRef | null,
  supportClassArgRefs: ObjectRef[],
  context: ExtractionContext,
): boolean => {
  const expectedRefs =
    supportClassArgRefs.length > 0
      ? supportClassArgRefs
      : operatorClassDataTypeRef
        ? [operatorClassDataTypeRef]
        : [];
  if (expectedRefs.length === 0) {
    return true;
  }

  const matches = (typeRef: ObjectRef | undefined, typeName: string): boolean =>
    typeRefMatchesBuiltInSupportTypeName(typeRef ?? null, typeName, context);
  const normalizedAccessMethod = accessMethod.toLowerCase();

  if (normalizedAccessMethod === "btree") {
    if (supportNumber === 1 && signature.length === 2) {
      if (expectedRefs.length === 1) {
        return signature.every((typeName) =>
          matches(expectedRefs[0], typeName),
        );
      }

      return (
        expectedRefs.length === 2 &&
        signature.every((typeName, index) =>
          matches(expectedRefs[index], typeName),
        )
      );
    }

    if (supportNumber === 3 && signature.length === 5) {
      if (expectedRefs.length === 1) {
        return signature
          .slice(0, 3)
          .every((typeName) => matches(expectedRefs[0], typeName));
      }

      return (
        expectedRefs.length === 2 &&
        matches(expectedRefs[0], signature[0] ?? "") &&
        matches(expectedRefs[0], signature[1] ?? "") &&
        matches(expectedRefs[1], signature[2] ?? "")
      );
    }
  }

  if (normalizedAccessMethod === "hash") {
    if (
      (supportNumber === 1 && signature.length === 1) ||
      (supportNumber === 2 && signature.length === 2)
    ) {
      return (
        expectedRefs.length === 1 &&
        matches(expectedRefs[0], signature[0] ?? "")
      );
    }
  }

  return true;
};

const isBuiltInOperatorClassSupportFunctionName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
  accessMethod: string,
  supportNumber: number,
  operatorClassDataTypeRef: ObjectRef | null,
  supportClassArgRefs: ObjectRef[] = [],
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name) {
    return false;
  }
  if (
    nameParts.length !== 1 &&
    !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  ) {
    return false;
  }

  if (
    accessMethod.toLowerCase() === "btree" &&
    supportNumber === 6 &&
    args.length === 1 &&
    typeRefMatchesBuiltInSupportTypeName(args[0] ?? null, "internal", context)
  ) {
    return isBuiltInBtreeSkipSupportFunctionName(name, ["internal"]);
  }

  const builtInSignatures =
    builtInOperatorClassSupportFunctionSignatures.get(name);
  if (!builtInSignatures) {
    return false;
  }

  return builtInSignatures.some(
    (signature) =>
      builtInOperatorClassSupportFunctionMatchesSlot(
        name,
        signature,
        accessMethod,
        supportNumber,
      ) &&
      args.length === signature.length &&
      signature.every((typeName, index) =>
        typeRefMatchesBuiltInSupportTypeName(
          args[index] ?? null,
          typeName,
          context,
        ),
      ) &&
      builtInOperatorClassSupportFunctionMatchesTypes(
        signature,
        accessMethod,
        supportNumber,
        operatorClassDataTypeRef,
        supportClassArgRefs,
        context,
      ),
  );
};

const builtInOperatorClassSupportOperatorNames = new Set([
  "<",
  "<=",
  "=",
  ">=",
  ">",
]);

const builtInPatternOperatorClassSupportOperatorNames = new Set([
  "~<~",
  "~<=~",
  "~>=~",
  "~>~",
]);

const builtInRecordImageOperatorClassSupportOperatorNames = new Set([
  "*<",
  "*<=",
  "*=",
  "*>=",
  "*>",
]);

const builtInBrinInclusionOperatorStrategies = new Map([
  ["<<", [1]],
  ["&&", [3]],
  ["&>", [4]],
  ["@>", [7, 16, 24, 25]],
  ["<@", [8, 26, 27]],
]);

const builtInGinSupportOperatorStrategies = new Map([
  ["&&", [1]],
  ["@>", [2, 7]],
  ["<@", [3]],
  ["=", [4]],
  ["?", [9]],
  ["?|", [10]],
  ["?&", [11]],
  ["@?", [15]],
  ["@@", [1, 6, 16]],
  ["@@@", [2]],
]);

const builtInGistSupportOperatorStrategies = new Map([
  ["<<", [1]],
  ["&<", [2]],
  ["&&", [3]],
  ["&>", [4]],
  [">>", [5]],
  ["-|-", [6]],
  ["@>", [7]],
  ["<@", [8]],
  ["=", [6, 18]],
  ["<->", [15]],
]);

const builtInSpgistSupportOperatorStrategies = new Map([
  ["~<~", [1]],
  ["~<=~", [2]],
  ["~>=~", [4]],
  ["~>~", [5]],
  ["<", [11, 20]],
  ["<=", [12, 21]],
  [">=", [14, 23]],
  [">", [15, 22]],
  ["<->", [15]],
  ["^@", [28]],
  ["<<", [1, 24]],
  ["&<", [2]],
  ["&&", [3]],
  ["&>", [4]],
  [">>", [5, 26]],
  ["-|-", [6]],
  ["@>", [7]],
  ["<@", [8]],
  ["=", [3, 6, 18]],
  ["<>", [19]],
  ["<<=", [25]],
  [">>=", [27]],
]);

const builtInBtreeOperatorStrategies = new Map([
  ["<", 1],
  ["<=", 2],
  ["=", 3],
  [">=", 4],
  [">", 5],
]);

const builtInBtreePatternOperatorStrategies = new Map([
  ["~<~", 1],
  ["~<=~", 2],
  ["~>=~", 4],
  ["~>~", 5],
]);

const builtInBtreeRecordImageOperatorStrategies = new Map([
  ["*<", 1],
  ["*<=", 2],
  ["*=", 3],
  ["*>=", 4],
  ["*>", 5],
]);

const builtInOperatorClassSupportOperatorMatchesSlot = (
  name: string,
  accessMethod: string,
  strategyNumber: number,
): boolean => {
  const normalizedAccessMethod = accessMethod.toLowerCase();
  if (normalizedAccessMethod === "btree") {
    return (
      builtInBtreeOperatorStrategies.get(name) === strategyNumber ||
      builtInBtreePatternOperatorStrategies.get(name) === strategyNumber ||
      builtInBtreeRecordImageOperatorStrategies.get(name) === strategyNumber
    );
  }

  if (normalizedAccessMethod === "hash") {
    return name === "=" && strategyNumber === 1;
  }

  if (normalizedAccessMethod === "brin") {
    if (
      builtInBrinInclusionOperatorStrategies
        .get(name)
        ?.includes(strategyNumber) === true
    ) {
      return true;
    }

    if (name === "=" && strategyNumber === 1) {
      return true;
    }

    return builtInBtreeOperatorStrategies.get(name) === strategyNumber;
  }

  if (normalizedAccessMethod === "gin") {
    return (
      builtInGinSupportOperatorStrategies
        .get(name)
        ?.includes(strategyNumber) === true
    );
  }

  if (normalizedAccessMethod === "gist") {
    return (
      builtInGistSupportOperatorStrategies
        .get(name)
        ?.includes(strategyNumber) === true
    );
  }

  if (normalizedAccessMethod === "spgist") {
    return (
      builtInSpgistSupportOperatorStrategies
        .get(name)
        ?.includes(strategyNumber) === true
    );
  }

  return false;
};

const typeRefMatchesBuiltInPatternOperatorType = (
  typeRef: ObjectRef | null,
): boolean =>
  typeRefMatchesBuiltInNames(typeRef, ["bpchar", "text", "varchar"]);

const typeRefMatchesBuiltInBrinInclusionOperatorType = (
  typeRef: ObjectRef | null,
  name: string,
  context: ExtractionContext,
): boolean => {
  const isRangeLike =
    typeRefMatchesPolymorphicBuiltInName(typeRef, "anyrange", context) ||
    typeRefMatchesPolymorphicBuiltInName(typeRef, "anymultirange", context);
  const isBox = typeRefMatchesBuiltInNames(typeRef, ["box"]);
  const isNetwork = typeRefMatchesBuiltInNames(typeRef, ["cidr", "inet"]);

  if (["<<", "&&"].includes(name)) {
    return isBox || isRangeLike || isNetwork;
  }

  if (["&>", "@>", "<@"].includes(name)) {
    return isBox || isRangeLike;
  }

  return false;
};

const typeRefMatchesBuiltInDistanceSupportOperatorType = (
  typeRef: ObjectRef | null,
): boolean => typeRefMatchesBuiltInNames(typeRef, ["point"]);

const builtInBtreeSupportOperatorTypeNames = new Set(
  [...builtInRangeOperatorClassSubtypes.values()].flat(),
);

const builtInHashOnlySupportOperatorTypeNames = new Set([
  "aclitem",
  "cid",
  "xid",
]);

const builtInBtreeCrossTypeSupportOperatorTypePairs = new Set([
  "date,timestamp",
  "date,timestamptz",
  "float4,float8",
  "float8,float4",
  "int2,int4",
  "int2,int8",
  "int4,int2",
  "int4,int8",
  "int8,int2",
  "int8,int4",
  "timestamp,date",
  "timestamp,timestamptz",
  "timestamptz,date",
  "timestamptz,timestamp",
]);

const typeRefMatchesBuiltInSupportOperatorType = (
  typeRef: ObjectRef | null,
  context: ExtractionContext,
  accessMethod: string,
): boolean =>
  typeRefMatchesBuiltInNames(typeRef, [
    ...builtInBtreeSupportOperatorTypeNames,
    ...(accessMethod.toLowerCase() === "hash"
      ? builtInHashOnlySupportOperatorTypeNames
      : []),
  ]) ||
  typeRefMatchesPolymorphicBuiltInName(typeRef, "anyarray", context) ||
  typeRefMatchesPolymorphicBuiltInName(typeRef, "anyenum", context) ||
  typeRefMatchesPolymorphicBuiltInName(typeRef, "anyrange", context) ||
  typeRefMatchesPolymorphicBuiltInName(typeRef, "anymultirange", context);

const typeRefsMatchBuiltInCrossTypeSupportOperator = (
  leftArg: ObjectRef | null,
  rightArg: ObjectRef | null,
  accessMethod: string,
): boolean => {
  if (
    accessMethod.toLowerCase() !== "btree" ||
    !leftArg ||
    !rightArg ||
    leftArg.kind !== "type" ||
    rightArg.kind !== "type" ||
    !isBuiltInObjectRef(leftArg) ||
    !isBuiltInObjectRef(rightArg)
  ) {
    return false;
  }

  return builtInBtreeCrossTypeSupportOperatorTypePairs.has(
    `${leftArg.name.toLowerCase()},${rightArg.name.toLowerCase()}`,
  );
};

const typeRefsMatchBuiltInGinSupportOperator = (
  name: string,
  leftArg: ObjectRef | null,
  rightArg: ObjectRef | null,
): boolean => {
  if (typeRefMatchesBuiltInNames(leftArg, ["tsvector"])) {
    return (
      (name === "@@" || name === "@@@") &&
      typeRefMatchesBuiltInNames(rightArg, ["tsquery"])
    );
  }

  if (typeRefMatchesBuiltInNames(leftArg, ["jsonb"])) {
    if (name === "?") {
      return typeRefMatchesBuiltInNames(rightArg, ["text"]);
    }

    if (name === "?|" || name === "?&") {
      return typeRefMatchesBuiltInNames(rightArg, ["text[]"]);
    }

    return (
      (name === "@?" || name === "@@") &&
      typeRefMatchesBuiltInNames(rightArg, ["jsonpath"])
    );
  }

  return false;
};

const isBuiltInOperatorClassSupportOperatorName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
  operatorClassDataTypeRef: ObjectRef | null,
  accessMethod: string,
  strategyNumber: number,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (
    (nameParts.length !== 1 &&
      !(
        nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog"
      )) ||
    !name ||
    (!builtInOperatorClassSupportOperatorNames.has(name) &&
      !builtInPatternOperatorClassSupportOperatorNames.has(name) &&
      !builtInRecordImageOperatorClassSupportOperatorNames.has(name) &&
      !builtInBrinInclusionOperatorStrategies.has(name) &&
      !builtInGinSupportOperatorStrategies.has(name) &&
      !builtInGistSupportOperatorStrategies.has(name) &&
      !builtInSpgistSupportOperatorStrategies.has(name))
  ) {
    return false;
  }

  if (
    !builtInOperatorClassSupportOperatorMatchesSlot(
      name,
      accessMethod,
      strategyNumber,
    )
  ) {
    return false;
  }

  if (builtInPatternOperatorClassSupportOperatorNames.has(name)) {
    if (args.length === 0) {
      return typeRefMatchesBuiltInPatternOperatorType(operatorClassDataTypeRef);
    }

    const leftArg = args[0] ?? null;
    const rightArg = args[1] ?? null;
    return (
      args.length === 2 &&
      objectRefsSameObject(leftArg, rightArg) &&
      typeRefMatchesBuiltInPatternOperatorType(leftArg)
    );
  }

  if (builtInRecordImageOperatorClassSupportOperatorNames.has(name)) {
    if (args.length === 0) {
      return typeRefMatchesBuiltInNames(operatorClassDataTypeRef, ["record"]);
    }

    const leftArg = args[0] ?? null;
    const rightArg = args[1] ?? null;
    return (
      args.length === 2 &&
      objectRefsSameObject(leftArg, rightArg) &&
      typeRefMatchesBuiltInNames(leftArg, ["record"])
    );
  }

  if (
    ["brin", "gist", "spgist"].includes(accessMethod.toLowerCase()) &&
    builtInBrinInclusionOperatorStrategies.has(name)
  ) {
    if (args.length === 0) {
      return typeRefMatchesBuiltInBrinInclusionOperatorType(
        operatorClassDataTypeRef,
        name,
        context,
      );
    }

    const leftArg = args[0] ?? null;
    const rightArg = args[1] ?? null;
    return (
      args.length === 2 &&
      objectRefsSameObject(leftArg, rightArg) &&
      typeRefMatchesBuiltInBrinInclusionOperatorType(leftArg, name, context)
    );
  }

  if (args.length === 0) {
    if (
      name === "<->" &&
      ["gist", "spgist"].includes(accessMethod.toLowerCase())
    ) {
      return typeRefMatchesBuiltInDistanceSupportOperatorType(
        operatorClassDataTypeRef,
      );
    }

    return typeRefMatchesBuiltInSupportOperatorType(
      operatorClassDataTypeRef,
      context,
      accessMethod,
    );
  }

  const leftArg = args[0] ?? null;
  const rightArg = args[1] ?? null;
  if (args.length !== 2) {
    return false;
  }
  if (!objectRefsSameObject(leftArg, rightArg)) {
    if (
      accessMethod.toLowerCase() === "gin" &&
      typeRefsMatchBuiltInGinSupportOperator(name, leftArg, rightArg)
    ) {
      return true;
    }

    return typeRefsMatchBuiltInCrossTypeSupportOperator(
      leftArg,
      rightArg,
      accessMethod,
    );
  }

  if (
    name === "<->" &&
    ["gist", "spgist"].includes(accessMethod.toLowerCase())
  ) {
    return typeRefMatchesBuiltInDistanceSupportOperatorType(leftArg);
  }

  return typeRefMatchesBuiltInSupportOperatorType(
    leftArg,
    context,
    accessMethod,
  );
};

const POSTGRES_IDENTIFIER_MAX_BYTES = 63;
const textEncoder = new TextEncoder();

const clipPostgresIdentifier = (
  identifier: string,
  maxBytes = POSTGRES_IDENTIFIER_MAX_BYTES,
): string => {
  let clipped = "";
  let byteLength = 0;

  for (const char of identifier) {
    const charLength = textEncoder.encode(char).length;
    if (byteLength + charLength > maxBytes) {
      break;
    }
    clipped += char;
    byteLength += charLength;
  }

  return clipped;
};

const defaultMultirangeTypeName = (rangeTypeName: string): string =>
  rangeTypeName.includes("range")
    ? clipPostgresIdentifier(rangeTypeName.replace("range", "multirange"))
    : `${clipPostgresIdentifier(
        rangeTypeName,
        POSTGRES_IDENTIFIER_MAX_BYTES -
          textEncoder.encode("_multirange").length,
      )}_multirange`;

const isRangeSelfTypeReference = (
  rangeRef: ObjectRef,
  requiredTypeRef: ObjectRef,
  explicitMultirangeRef?: ObjectRef | null,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean =>
  isSelfTypeReference(rangeRef, requiredTypeRef, context) ||
  (requiredTypeRef.kind === "type" &&
    explicitMultirangeRef?.kind === "type" &&
    requiredTypeRef.schema === explicitMultirangeRef.schema &&
    requiredTypeRef.name === explicitMultirangeRef.name) ||
  (requiredTypeRef.kind === "type" &&
    !explicitMultirangeRef &&
    requiredTypeRef.schema === rangeRef.schema &&
    requiredTypeRef.name === defaultMultirangeTypeName(rangeRef.name));

const baseTypeFunctionOptionNames = new Set([
  "input",
  "output",
  "receive",
  "send",
  "typmod_in",
  "typmod_out",
  "analyze",
  "subscript",
]);

const builtInBaseTypeCallbackNamesByOption = new Map([
  ["analyze", new Set(["array_typanalyze"])],
  ["subscript", new Set(["array_subscript_handler"])],
]);

const isBuiltInBaseTypeCallbackName = (
  optionName: string,
  nameParts: string[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (
    !name ||
    (nameParts.length !== 1 &&
      !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog"))
  ) {
    return false;
  }

  return (
    builtInBaseTypeCallbackNamesByOption.get(optionName)?.has(name) === true
  );
};

const baseTypeTypeOptionNames = new Set(["like", "element"]);

const typeSignaturePart = (typeRef: ObjectRef): string =>
  typeRef.kind === "type" &&
  typeRef.schema?.toLowerCase() === "pg_catalog" &&
  typeRef.explicitSchema === true
    ? `${typeRef.schema}.${typeRef.name}`
    : isBuiltInObjectRef(typeRef)
      ? typeRef.name
      : typeRef.schema
        ? `${typeRef.schema}.${typeRef.name}`
        : typeRef.name;

const catalogQualifiedBuiltInTypeRef = (typeRef: ObjectRef): ObjectRef =>
  typeRef.kind === "type" && isBuiltInObjectRef(typeRef)
    ? markExplicitSchemaRef(
        createObjectRefFromAst("type", typeRef.name, "pg_catalog"),
      )
    : typeRef;

const operatorClassTypeSignaturePart = (typeRef: ObjectRef): string =>
  isBuiltInObjectRef(typeRef) ? typeRef.name : typeSignaturePart(typeRef);

const operatorClassSignature = (
  accessMethod: string,
  dataTypeRef: ObjectRef | null,
): string | undefined =>
  accessMethod
    ? dataTypeRef
      ? `(${accessMethod},${operatorClassTypeSignaturePart(dataTypeRef)})`
      : accessMethod
    : undefined;

const operatorClassIdentitySignature = (
  accessMethod: string,
): string | undefined => (accessMethod ? `(${accessMethod})` : undefined);

const operatorFamilySignature = (accessMethod: string): string | undefined => {
  const trimmed = accessMethod.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("(") && trimmed.endsWith(")")
    ? trimmed
    : `(${trimmed})`;
};

const operatorFamilyAccessMethodFromSignature = (
  signature?: string,
): string | null => {
  const trimmed = signature?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized =
    trimmed.startsWith("(") && trimmed.endsWith(")")
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return normalized && !normalized.includes(",") ? normalized : null;
};

const operatorNoneArgRef = (): ObjectRef =>
  createObjectRefFromAst("type", "none");

const isOperatorNoneArgRef = (ref: ObjectRef): boolean =>
  ref.kind === "type" && ref.schema === undefined && ref.name === "none";

const isOperatorNoneArgNode = (argNode: unknown): boolean => {
  const argRecord = asRecord(argNode);
  if (argRecord && Object.keys(argRecord).length === 0) {
    return true;
  }
  const typeName = asRecord(asRecord(argNode)?.TypeName);
  const nameParts = extractNameParts(typeName?.names);
  return nameParts.length === 1 && nameParts[0]?.toLowerCase() === "none";
};

const objectWithArgsTypeRefs = (
  objectWithArgs: unknown,
  options: { preserveOperatorNone?: boolean } = {},
): (ObjectRef | null)[] => {
  const objectWithArgsRecord = asRecord(objectWithArgs);
  const args = Array.isArray(objectWithArgsRecord?.objargs)
    ? objectWithArgsRecord.objargs
    : [];

  return args.map((argNode) => {
    if (options.preserveOperatorNone && isOperatorNoneArgNode(argNode)) {
      return operatorNoneArgRef();
    }
    return typeFromTypeNameNode(asRecord(argNode)?.TypeName);
  });
};

const typeRefsSignature = (
  args: (ObjectRef | null)[],
  returnType?: ObjectRef | null,
): string =>
  `(${args
    .map((argRef) => (argRef ? typeSignaturePart(argRef) : "unknown"))
    .join(",")})${returnType ? `->${typeSignaturePart(returnType)}` : ""}`;

const returnTypeSignaturePart = (signature?: string): string | null => {
  const separatorIndex = signature?.indexOf("->") ?? -1;
  if (!signature || separatorIndex < 0) {
    return null;
  }
  const returnType = signature.slice(separatorIndex + "->".length).trim();
  return returnType.length > 0 ? returnType : null;
};

const routineReturnTypeSignaturePart = (
  context: ExtractionContext,
  functionRef: ObjectRef,
  argsSignature: string | undefined,
): string | null => {
  if (!argsSignature) {
    return null;
  }
  for (const providerRef of context.routineReturnProviders) {
    if (
      providerRef.kind !== "function" ||
      providerRef.name !== functionRef.name ||
      providerRef.schema !== functionRef.schema
    ) {
      continue;
    }
    if (
      signaturesCompatible(argsSignature, providerRef.signature, {
        requireExactArity: true,
      })
    ) {
      return returnTypeSignaturePart(providerRef.signature);
    }
  }
  return builtInOperatorImplementationReturnType(functionRef, argsSignature);
};

const objectWithArgsRef = (
  kind: ObjectRef["kind"],
  objectWithArgs: unknown,
  defaultArgs: (ObjectRef | null)[] = [],
  options: { preserveOperatorNone?: boolean } = {},
): ObjectRef | null => {
  const objectWithArgsRecord = asRecord(objectWithArgs);
  if (!objectWithArgsRecord) {
    return null;
  }

  const baseRef = objectFromNameParts(
    kind,
    extractNameParts(objectWithArgsRecord.objname),
  );
  if (!baseRef) {
    return null;
  }

  const explicitArgs = objectWithArgsTypeRefs(objectWithArgsRecord, options);
  const args = explicitArgs.length > 0 ? explicitArgs : defaultArgs;
  if (args.length === 0) {
    return baseRef;
  }

  return createObjectRefFromAst(
    kind,
    baseRef.name,
    baseRef.schema,
    typeRefsSignature(args),
  );
};

const inferredOperatorClassSupportFunctionArgs = (
  accessMethod: string,
  supportNumber: number,
  dataTypeRef: ObjectRef | null,
  classArgRefs: ObjectRef[],
): (ObjectRef | null)[] => {
  const normalizedAccessMethod = accessMethod.toLowerCase();
  const defaultTypeArgs =
    classArgRefs.length >= 2
      ? [classArgRefs[0], classArgRefs[1]]
      : classArgRefs.length === 1
        ? [classArgRefs[0], classArgRefs[0]]
        : dataTypeRef
          ? [dataTypeRef, dataTypeRef]
          : [];

  if (normalizedAccessMethod === "btree") {
    if (supportNumber === 1) {
      return defaultTypeArgs;
    }
    if (supportNumber === 2) {
      return [createObjectRefFromAst("type", "internal", "pg_catalog")];
    }
  }

  if (normalizedAccessMethod === "hash") {
    if (supportNumber === 1 && dataTypeRef) {
      return [dataTypeRef];
    }
    if (supportNumber === 2 && dataTypeRef) {
      return [
        dataTypeRef,
        createObjectRefFromAst("type", "int8", "pg_catalog"),
      ];
    }
  }

  return [];
};

const operatorClassOptionsSupportFunctionSlots: Record<string, number> = {
  btree: 5,
  hash: 3,
  gist: 10,
  spgist: 6,
  gin: 7,
  brin: 5,
};

const operatorClassSupportFunctionReturnType = (
  accessMethod: string,
  supportNumber: number,
): ObjectRef | null => {
  const normalizedAccessMethod = accessMethod.toLowerCase();
  if (
    operatorClassOptionsSupportFunctionSlots[normalizedAccessMethod] ===
    supportNumber
  ) {
    return createObjectRefFromAst("type", "void");
  }

  if (normalizedAccessMethod === "brin") {
    if (supportNumber === 1) {
      return createObjectRefFromAst("type", "internal");
    }
    if (supportNumber === 2 || supportNumber === 3) {
      return createObjectRefFromAst("type", "bool");
    }
    if (supportNumber === 4) {
      return createObjectRefFromAst("type", "void");
    }
  }

  if (normalizedAccessMethod === "btree") {
    if (supportNumber === 1) {
      return createObjectRefFromAst("type", "int4");
    }
    if (supportNumber === 2 || supportNumber === 6) {
      return createObjectRefFromAst("type", "void");
    }
    if (supportNumber === 3 || supportNumber === 4) {
      return createObjectRefFromAst("type", "bool");
    }
  }

  if (normalizedAccessMethod === "hash") {
    if (supportNumber === 1) {
      return createObjectRefFromAst("type", "int4");
    }
    if (supportNumber === 2) {
      return createObjectRefFromAst("type", "int8");
    }
  }

  if (normalizedAccessMethod === "gist") {
    if (supportNumber === 1) {
      return createObjectRefFromAst("type", "bool");
    }
    if (supportNumber === 8) {
      return createObjectRefFromAst("type", "float8");
    }
    if (supportNumber === 11) {
      return createObjectRefFromAst("type", "void");
    }
  }

  if (normalizedAccessMethod === "gin") {
    if (supportNumber === 1 || supportNumber === 5) {
      return createObjectRefFromAst("type", "int4");
    }
    if (supportNumber === 2 || supportNumber === 3) {
      return createObjectRefFromAst("type", "internal");
    }
    if (supportNumber === 4) {
      return createObjectRefFromAst("type", "bool");
    }
    if (supportNumber === 6) {
      return createObjectRefFromAst("type", "char");
    }
  }

  if (normalizedAccessMethod === "spgist") {
    if ([1, 2, 3, 4].includes(supportNumber)) {
      return createObjectRefFromAst("type", "void");
    }
    if (supportNumber === 5) {
      return createObjectRefFromAst("type", "bool");
    }
  }

  return null;
};

const objectRefFromNamePartsWithArgs = (
  kind: ObjectRef["kind"],
  nameParts: string[],
  args: (ObjectRef | null)[],
): ObjectRef | null => {
  const baseRef = objectFromNameParts(kind, nameParts);
  if (!baseRef) {
    return null;
  }
  if (args.length === 0) {
    return baseRef;
  }

  return createObjectRefFromAst(
    kind,
    baseRef.name,
    baseRef.schema,
    typeRefsSignature(args),
  );
};

const rangeFunctionArgs = (
  optionName: string,
  rangeRef: ObjectRef | null,
  subtypeRef: ObjectRef | null,
): (ObjectRef | null)[] => {
  if (optionName === "canonical") {
    return rangeRef ? [rangeRef] : [];
  }

  if (optionName === "subtype_diff") {
    if (!subtypeRef) {
      return [];
    }
    const signatureSubtypeRef = catalogQualifiedBuiltInTypeRef(subtypeRef);
    return [signatureSubtypeRef, signatureSubtypeRef];
  }

  return [];
};

const rangeFunctionReturnType = (
  optionName: string,
  rangeRef: ObjectRef | null,
): ObjectRef | null => {
  if (optionName === "canonical") {
    return rangeRef;
  }

  if (optionName === "subtype_diff") {
    return createObjectRefFromAst("type", "float8");
  }

  return null;
};

const rangeSubtypeRef = (params: unknown[]): ObjectRef | null => {
  for (const paramNode of params) {
    const defElem = asRecord(asRecord(paramNode)?.DefElem);
    if (!defElem) {
      continue;
    }
    const optionName =
      typeof defElem.defname === "string" ? defElem.defname.toLowerCase() : "";
    if (optionName !== "subtype") {
      continue;
    }
    return typeFromTypeNameNode(asRecord(asRecord(defElem.arg)?.TypeName));
  }

  return null;
};

const objectRefsSameObject = (
  left: ObjectRef | null,
  right: ObjectRef | null,
): boolean => {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  return (
    (left.schema ?? DEFAULT_SCHEMA) === (right.schema ?? DEFAULT_SCHEMA) &&
    left.name === right.name
  );
};

const addTypeKey = (typeKeys: Set<string>, typeRef: ObjectRef | null): void => {
  if (!typeRef) {
    return;
  }
  typeKeys.add(normalizedTypeContextKey(typeRef));
};

const addCreatedTypeKey = (
  typeKeys: Set<string>,
  typeRef: ObjectRef | null,
): void => {
  if (!typeRef) {
    return;
  }
  typeKeys.add(contextTypeKey(typeRef));
};

const operatorFamilyContextKey = (
  familyRef: ObjectRef,
  accessMethod: string,
): string =>
  objectRefKey(
    createObjectRefFromAst(
      "operator_family",
      familyRef.name,
      familyRef.schema ?? DEFAULT_SCHEMA,
      operatorFamilySignature(accessMethod),
    ),
  );

export const createExtractionContext = (
  astNodes: readonly unknown[],
  externalProviders: readonly ObjectRef[] = [],
): ExtractionContext => {
  const createdTypeKeys = new Set<string>();
  const enumTypeKeys = new Set<string>();
  const rangeTypeKeys = new Set<string>();
  const multirangeTypeKeys = new Set<string>();
  const domainBaseTypes = new Map<string, ObjectRef>();
  const operatorFamilyKeys = new Set<string>();
  const routineReturnProviders: ObjectRef[] = [];

  for (const astNode of astNodes) {
    const astRecord = asRecord(astNode);
    const operatorFamilyStmt = asRecord(astRecord?.CreateOpFamilyStmt);
    if (operatorFamilyStmt) {
      const accessMethod =
        typeof operatorFamilyStmt.amname === "string"
          ? operatorFamilyStmt.amname
          : "";
      const operatorFamilyRef = objectFromNameParts(
        "operator_family",
        extractNameParts(operatorFamilyStmt.opfamilyname),
      );
      if (operatorFamilyRef) {
        operatorFamilyKeys.add(
          operatorFamilyContextKey(operatorFamilyRef, accessMethod),
        );
      }
    }

    const operatorClassStmt = asRecord(astRecord?.CreateOpClassStmt);
    if (operatorClassStmt) {
      const accessMethod =
        typeof operatorClassStmt.amname === "string"
          ? operatorClassStmt.amname
          : "";
      const explicitOperatorFamilyRef = objectFromNameParts(
        "operator_family",
        extractNameParts(operatorClassStmt.opfamilyname),
      );
      const implicitOperatorFamilyRef = objectFromNameParts(
        "operator_family",
        extractNameParts(operatorClassStmt.opclassname),
      );
      if (!explicitOperatorFamilyRef && implicitOperatorFamilyRef) {
        operatorFamilyKeys.add(
          operatorFamilyContextKey(implicitOperatorFamilyRef, accessMethod),
        );
      }
    }

    const functionStmt = asRecord(astRecord?.CreateFunctionStmt);
    if (functionStmt) {
      const extraction = extractCreateFunctionDependencies(
        functionStmt,
        "function",
      );
      routineReturnProviders.push(
        ...extraction.provides.filter((providedRef) =>
          Boolean(returnTypeSignaturePart(providedRef.signature)),
        ),
      );
    }

    const domainStmt = asRecord(astRecord?.CreateDomainStmt);
    const domainRef = objectFromNameParts(
      "type",
      extractNameParts(domainStmt?.domainname),
    );
    const domainBaseTypeRef = typeFromTypeNameNode(domainStmt?.typeName);
    addCreatedTypeKey(createdTypeKeys, domainRef);
    if (domainRef && domainBaseTypeRef) {
      domainBaseTypes.set(objectRefKey(domainRef), domainBaseTypeRef);
    }

    const enumStmt = asRecord(astRecord?.CreateEnumStmt);
    const enumRef = objectFromNameParts(
      "type",
      extractNameParts(enumStmt?.typeName),
    );
    addCreatedTypeKey(createdTypeKeys, enumRef);
    addTypeKey(enumTypeKeys, enumRef);

    const defineStmt = asRecord(astRecord?.DefineStmt);
    if (defineStmt?.kind === "OBJECT_TYPE") {
      addCreatedTypeKey(
        createdTypeKeys,
        objectFromNameParts("type", extractNameParts(defineStmt.defnames)),
      );
    }

    const compositeStmt = asRecord(astRecord?.CompositeTypeStmt);
    addCreatedTypeKey(
      createdTypeKeys,
      relationFromRangeVarNode(asRecord(compositeStmt?.typevar), "type"),
    );

    const createStmt = asRecord(astRecord?.CreateStmt);
    const createStmtRelationRef = relationFromRangeVarNode(
      asRecord(createStmt?.relation),
      "table",
    );
    if (createStmtRelationRef) {
      addCreatedTypeKey(
        createdTypeKeys,
        relationRowTypeRef(createStmtRelationRef),
      );
    }

    const viewStmt = asRecord(astRecord?.ViewStmt);
    const viewRelationRef = relationFromRangeVarNode(
      asRecord(viewStmt?.view),
      "table",
    );
    if (viewRelationRef) {
      addCreatedTypeKey(createdTypeKeys, relationRowTypeRef(viewRelationRef));
    }

    const createTableAsStmt = asRecord(astRecord?.CreateTableAsStmt);
    const intoClause = asRecord(createTableAsStmt?.into);
    const createTableAsRelationRef = relationFromRangeVarNode(
      asRecord(intoClause?.rel),
      "table",
    );
    if (createTableAsRelationRef) {
      addCreatedTypeKey(
        createdTypeKeys,
        relationRowTypeRef(createTableAsRelationRef),
      );
    }

    const rangeStmt = asRecord(astRecord?.CreateRangeStmt);
    const rangeRef = objectFromNameParts(
      "type",
      extractNameParts(rangeStmt?.typeName),
    );
    addCreatedTypeKey(createdTypeKeys, rangeRef);
    addTypeKey(rangeTypeKeys, rangeRef);
    if (!rangeRef) {
      continue;
    }

    const params = Array.isArray(rangeStmt?.params) ? rangeStmt.params : [];
    let hasExplicitMultirangeTypeName = false;
    for (const paramNode of params) {
      const defElem = asRecord(asRecord(paramNode)?.DefElem);
      const optionName =
        typeof defElem?.defname === "string"
          ? defElem.defname.toLowerCase()
          : "";
      if (optionName !== "multirange_type_name") {
        continue;
      }
      hasExplicitMultirangeTypeName = true;
      const typeName = asRecord(asRecord(defElem?.arg)?.TypeName);
      const multirangeRef = objectFromNameParts(
        "type",
        extractNameParts(typeName?.names),
        rangeRef.schema ?? DEFAULT_SCHEMA,
      );
      addCreatedTypeKey(createdTypeKeys, multirangeRef);
      addTypeKey(multirangeTypeKeys, multirangeRef);
    }

    if (!hasExplicitMultirangeTypeName) {
      const defaultMultirangeRef = createObjectRefFromAst(
        "type",
        defaultMultirangeTypeName(rangeRef.name),
        rangeRef.schema,
      );
      addCreatedTypeKey(createdTypeKeys, defaultMultirangeRef);
      addTypeKey(multirangeTypeKeys, defaultMultirangeRef);
    }
  }

  for (const providerRef of externalProviders) {
    if (
      providerRef.kind === "function" &&
      returnTypeSignaturePart(providerRef.signature)
    ) {
      routineReturnProviders.push(providerRef);
    }

    if (providerRef.kind === "operator_family") {
      const accessMethod = operatorFamilyAccessMethodFromSignature(
        providerRef.signature,
      );
      if (accessMethod) {
        operatorFamilyKeys.add(
          operatorFamilyContextKey(providerRef, accessMethod),
        );
      }
    }

    if (
      providerRef.kind === "table" ||
      providerRef.kind === "view" ||
      providerRef.kind === "materialized_view"
    ) {
      addCreatedTypeKey(createdTypeKeys, relationRowTypeRef(providerRef));
      continue;
    }

    if (providerRef.kind !== "type" && providerRef.kind !== "domain") {
      continue;
    }
    const typeRef = createObjectRefFromAst(
      "type",
      providerRef.name,
      providerRef.schema ?? DEFAULT_SCHEMA,
    );
    addCreatedTypeKey(createdTypeKeys, typeRef);
    const signature = providerRef.signature?.trim().toLowerCase();
    if (signature === "(enum)") {
      addTypeKey(enumTypeKeys, typeRef);
    } else if (signature === "(range)") {
      addTypeKey(rangeTypeKeys, typeRef);
    } else if (signature === "(multirange)") {
      addTypeKey(multirangeTypeKeys, typeRef);
    }
  }

  return {
    createdTypeKeys,
    enumTypeKeys,
    rangeTypeKeys,
    multirangeTypeKeys,
    domainBaseTypes,
    operatorFamilyKeys,
    routineReturnProviders,
  };
};

export const domainBaseTypeRef = (
  subtypeRef: ObjectRef,
  context: ExtractionContext,
): ObjectRef | null => {
  let currentRef: ObjectRef | undefined = subtypeRef;
  const seenKeys = new Set<string>();

  while (currentRef) {
    const key = objectRefKey(
      createObjectRefFromAst(
        "type",
        currentRef.name,
        currentRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    if (seenKeys.has(key)) {
      return null;
    }
    seenKeys.add(key);

    const baseRef = context.domainBaseTypes.get(key);
    if (!baseRef) {
      return currentRef === subtypeRef ? null : currentRef;
    }
    currentRef = baseRef;
  }

  return null;
};

export const omittedRangeSubtypeOperatorClassSubtypeRef = (
  statementNode: unknown,
): ObjectRef | null => {
  const statementRecord = asRecord(statementNode);
  if (!statementRecord) {
    return null;
  }

  const rangeStatement =
    asRecord(statementRecord.CreateRangeStmt) ?? statementRecord;
  const params = Array.isArray(rangeStatement.params)
    ? rangeStatement.params
    : [];
  const subtypeRef = rangeSubtypeRef(params);

  for (const paramNode of params) {
    const defElem = asRecord(asRecord(paramNode)?.DefElem);
    const optionName =
      typeof defElem?.defname === "string" ? defElem.defname.toLowerCase() : "";
    if (optionName === "subtype_opclass") {
      return null;
    }
  }

  if (!subtypeRef) {
    return null;
  }

  return subtypeRef;
};

export const defaultBtreeOperatorClassProviderRefForSubtype = (
  statementNode: unknown,
  subtypeRef: ObjectRef,
): ObjectRef | null => {
  const statementRecord = asRecord(statementNode);
  const opClassStatement =
    asRecord(statementRecord?.CreateOpClassStmt) ?? statementRecord;
  if (!opClassStatement) {
    return null;
  }

  if (opClassStatement.isDefault !== true) {
    return null;
  }

  if (
    typeof opClassStatement.amname !== "string" ||
    opClassStatement.amname.toLowerCase() !== "btree"
  ) {
    return null;
  }

  const dataTypeRef = typeFromTypeNameNode(opClassStatement.datatype);
  if (!objectRefsSameObject(dataTypeRef, subtypeRef)) {
    return null;
  }

  const operatorClassRef = objectFromNameParts(
    "operator_class",
    extractNameParts(opClassStatement.opclassname),
  );
  return operatorClassRef
    ? createObjectRefFromAst(
        "operator_class",
        operatorClassRef.name,
        operatorClassRef.schema,
        operatorClassSignature("btree", dataTypeRef),
      )
    : null;
};

export const hasPgCatalogDefaultBtreeOperatorClassForSubtype = (
  subtypeRef: ObjectRef,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): boolean => {
  const effectiveSubtypeRef =
    domainBaseTypeRef(subtypeRef, context) ?? subtypeRef;

  return (
    typeRefMatchesPolymorphicBuiltInName(
      effectiveSubtypeRef,
      "anyarray",
      context,
    ) ||
    typeRefMatchesPolymorphicBuiltInName(
      effectiveSubtypeRef,
      "anyenum",
      context,
    ) ||
    typeRefMatchesPolymorphicBuiltInName(
      effectiveSubtypeRef,
      "anyrange",
      context,
    ) ||
    typeRefMatchesPolymorphicBuiltInName(
      effectiveSubtypeRef,
      "anymultirange",
      context,
    ) ||
    isBuiltInRangeOperatorClassName(
      [`${effectiveSubtypeRef.name}_ops`],
      effectiveSubtypeRef,
      context,
    )
  );
};

const extractCreateRangeDependencies = (
  statementNode: Record<string, unknown>,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const diagnostics: Diagnostic[] = [];

  const rangeRef = objectFromNameParts(
    "type",
    extractNameParts(statementNode.typeName),
  );
  if (rangeRef) {
    provides.push(...typeProviderRefs(rangeRef, context));
    addImplicitArrayCollisionDependency(rangeRef, requires, context);
    requires.push(
      markOmitIfNoLocalProducerRef(
        createObjectRefFromAst(
          "type",
          rangeRef.name,
          rangeRef.schema,
          SHELL_TYPE_SIGNATURE,
        ),
      ),
    );
    if (rangeRef.schema) {
      requires.push(createObjectRefFromAst("schema", rangeRef.schema));
    }
  }

  const params = Array.isArray(statementNode.params)
    ? statementNode.params
    : [];
  const subtypeRef = rangeSubtypeRef(params);
  const explicitMultirangeTypeName = params
    .map((paramNode) => asRecord(asRecord(paramNode)?.DefElem))
    .find(
      (defElem) =>
        typeof defElem?.defname === "string" &&
        defElem.defname.toLowerCase() === "multirange_type_name",
    );
  const explicitMultirangeRef = objectFromNameParts(
    "type",
    extractNameParts(
      asRecord(asRecord(explicitMultirangeTypeName?.arg)?.TypeName)?.names,
    ),
    rangeRef?.schema ?? DEFAULT_SCHEMA,
  );
  let hasExplicitMultirangeTypeName = false;

  for (const paramNode of params) {
    const defElem = asRecord(asRecord(paramNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }
    const optionName = defElem.defname.toLowerCase();
    const typeName = asRecord(asRecord(defElem.arg)?.TypeName);

    if (optionName === "subtype") {
      const typeRef = typeFromTypeNameNode(typeName);
      if (typeRef) {
        requires.push(typeRef);
        if (
          typeRef.schema?.toLowerCase() === "pg_catalog" &&
          !isKnownPgCatalogTypeRef(typeRef)
        ) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            message: `No valid pg_catalog range subtype '${typeRef.name}' found.`,
            objectRefs: [typeRef],
            suggestedFix:
              "Use a valid pg_catalog type or create the referenced range subtype explicitly in a user schema.",
          });
        }
        if (
          rangeRef &&
          isRangeSelfTypeReference(
            rangeRef,
            typeRef,
            explicitMultirangeRef,
            context,
          )
        ) {
          diagnostics.push(
            selfReferenceDiagnostic(
              typeRef,
              `Range type '${rangeRef.schema ? `${rangeRef.schema}.` : ""}${rangeRef.name}' cannot use itself as its subtype.`,
            ),
          );
        }
      }
      continue;
    }

    if (optionName === "collation") {
      const collationNameParts = extractNameParts(typeName?.names);
      const collationRef = objectFromNameParts("collation", collationNameParts);
      if (collationRef) {
        if (isBuiltInRangeCollationName(collationNameParts)) {
          if (collationNameParts.length === 1) {
            requires.push(markOmitIfNoLocalProducerRef(collationRef));
          }
        } else {
          requires.push(collationRef);
          if (collationRef.schema?.toLowerCase() === "pg_catalog") {
            diagnostics.push({
              code: "UNRESOLVED_DEPENDENCY",
              message: `No pg_catalog collation '${collationRef.name}' found for range type.`,
              objectRefs: [collationRef],
              suggestedFix:
                "Use a valid pg_catalog collation or create the referenced collation explicitly in a user schema.",
            });
          }
        }
      }
      continue;
    }

    if (optionName === "subtype_opclass") {
      const operatorClassNameParts = extractNameParts(typeName?.names);
      const operatorClassRef = objectFromNameParts(
        "operator_class",
        operatorClassNameParts,
      );
      if (operatorClassRef) {
        // PostgreSQL range subtypes resolve SUBTYPE_OPCLASS against the btree
        // access method, even when another method has an opclass with the same
        // schema/name.
        const operatorClassSubtypeRef = subtypeRef
          ? (domainBaseTypeRef(subtypeRef, context) ?? subtypeRef)
          : null;
        const operatorClassRequirement = createObjectRefFromAst(
          "operator_class",
          operatorClassRef.name,
          operatorClassRef.schema,
          operatorClassSignature("btree", operatorClassSubtypeRef),
        );
        const isBuiltInRangeOperatorClass = isBuiltInRangeOperatorClassName(
          operatorClassNameParts,
          operatorClassSubtypeRef,
          context,
        );
        if (isBuiltInRangeOperatorClass) {
          if (operatorClassNameParts.length === 1) {
            requires.push(
              markOmitIfNoLocalProducerRef(operatorClassRequirement),
            );
          }
        } else {
          requires.push(operatorClassRequirement);
          if (operatorClassRef.schema?.toLowerCase() === "pg_catalog") {
            const subtypeName = operatorClassSubtypeRef
              ? typeSignaturePart(operatorClassSubtypeRef)
              : "unknown";
            diagnostics.push({
              code: "UNRESOLVED_DEPENDENCY",
              message: `No compatible pg_catalog btree operator class '${operatorClassRef.name}' found for range subtype '${subtypeName}'.`,
              objectRefs: [operatorClassRequirement],
              suggestedFix:
                "Use a btree operator class whose input type matches the range subtype.",
            });
          }
        }
      }
      continue;
    }

    if (optionName === "multirange_type_name") {
      hasExplicitMultirangeTypeName = true;
      const multirangeRef = objectFromNameParts(
        "type",
        extractNameParts(typeName?.names),
        rangeRef?.schema ?? DEFAULT_SCHEMA,
      );
      if (multirangeRef) {
        if (rangeRef && objectRefsSameObject(multirangeRef, rangeRef)) {
          diagnostics.push(
            selfReferenceDiagnostic(
              multirangeRef,
              `Range type '${rangeRef.schema ? `${rangeRef.schema}.` : ""}${rangeRef.name}' cannot reuse its own name as MULTIRANGE_TYPE_NAME.`,
            ),
          );
          continue;
        }
        provides.push(...typeProviderRefs(multirangeRef, context));
        addImplicitArrayCollisionDependency(multirangeRef, requires, context);
        if (multirangeRef.schema) {
          requires.push(createObjectRefFromAst("schema", multirangeRef.schema));
        }
      }
      continue;
    }

    if (rangeFunctionOptionNames.has(optionName)) {
      const functionNameParts = extractNameParts(typeName?.names);
      const functionArgs = rangeFunctionArgs(optionName, rangeRef, subtypeRef);
      const functionReturnType = rangeFunctionReturnType(optionName, rangeRef);
      const functionRef = objectRefFromNamePartsWithArgs(
        "function",
        functionNameParts,
        functionArgs,
      );
      if (functionRef) {
        const exactFunctionWithReturnRef = createObjectRefFromAst(
          "function",
          functionRef.name,
          functionRef.schema,
          typeRefsSignature(functionArgs, functionReturnType),
        );
        const exactFunctionRef = markExactKindRef(
          markExactSignatureRef(exactFunctionWithReturnRef),
        );
        if (
          isBuiltInRangeSupportFunctionName(functionNameParts, functionArgs)
        ) {
          if (functionNameParts.length === 1) {
            requires.push(markOmitIfNoLocalProducerRef(exactFunctionRef));
          }
          continue;
        }

        requires.push(exactFunctionRef);
        if (isPgCatalogQualifiedName(functionNameParts)) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            message: `No valid pg_catalog range support function '${functionRef.name}' found for range option '${optionName}'.`,
            objectRefs: [exactFunctionRef],
            suggestedFix:
              "Use a pg_catalog range support function whose signature matches the selected range option and subtype.",
          });
        }
      }
    }
  }

  if (rangeRef && !hasExplicitMultirangeTypeName) {
    // PostgreSQL creates a default multirange type alongside every range type.
    // The name is derived from the range type unless MULTIRANGE_TYPE_NAME is
    // present, in which case the explicit option above is the only provider.
    const defaultMultirangeRef = createObjectRefFromAst(
      "type",
      defaultMultirangeTypeName(rangeRef.name),
      rangeRef.schema,
    );
    provides.push(...typeProviderRefs(defaultMultirangeRef, context));
    addImplicitArrayCollisionDependency(
      defaultMultirangeRef,
      requires,
      context,
    );
  }

  return { provides, requires, diagnostics };
};

const operatorImplementationFunctionOptionNames = new Set([
  "function",
  "procedure",
]);
const operatorEstimatorFunctionOptionNames = new Set(["restrict", "join"]);
const operatorLinkOptionNames = new Set(["commutator", "negator"]);
const builtInRestrictEstimatorFunctionNames = new Set([
  "areasel",
  "arraycontsel",
  "contsel",
  "eqsel",
  "iclikesel",
  "icnlikesel",
  "likesel",
  "matchingsel",
  "neqsel",
  "nlikesel",
  "positionsel",
  "scalargesel",
  "scalarlesel",
  "scalarltsel",
  "scalargtsel",
]);

const builtInJoinEstimatorFunctionNames = new Set([
  "areajoinsel",
  "arraycontjoinsel",
  "contjoinsel",
  "eqjoinsel",
  "iclikejoinsel",
  "icnlikejoinsel",
  "likejoinsel",
  "matchingjoinsel",
  "neqjoinsel",
  "nlikejoinsel",
  "positionjoinsel",
  "scalargejoinsel",
  "scalarlejoinsel",
  "scalarltjoinsel",
  "scalargtjoinsel",
]);

const builtInEstimatorFunctionNamesByOption = new Map([
  ["restrict", builtInRestrictEstimatorFunctionNames],
  ["join", builtInJoinEstimatorFunctionNames],
]);

const builtInOperatorImplementationFunctionSignatures = new Map<
  string,
  string[][]
>([
  ["booleq", [["bool", "bool"]]],
  ["boolge", [["bool", "bool"]]],
  ["boolgt", [["bool", "bool"]]],
  ["boolle", [["bool", "bool"]]],
  ["boollt", [["bool", "bool"]]],
  ["boolne", [["bool", "bool"]]],
  ["array_eq", [["anyarray", "anyarray"]]],
  ["array_ne", [["anyarray", "anyarray"]]],
  ["arraycontained", [["anyarray", "anyarray"]]],
  ["arraycontains", [["anyarray", "anyarray"]]],
  ["arrayoverlap", [["anyarray", "anyarray"]]],
  ["biteq", [["bit", "bit"]]],
  ["bitge", [["bit", "bit"]]],
  ["bitgt", [["bit", "bit"]]],
  ["bitle", [["bit", "bit"]]],
  ["bitlt", [["bit", "bit"]]],
  ["bitne", [["bit", "bit"]]],
  ["bpchareq", [["bpchar", "bpchar"]]],
  ["bpcharge", [["bpchar", "bpchar"]]],
  ["bpchargt", [["bpchar", "bpchar"]]],
  ["bpcharle", [["bpchar", "bpchar"]]],
  ["bpcharlt", [["bpchar", "bpchar"]]],
  ["bpcharne", [["bpchar", "bpchar"]]],
  ["byteaeq", [["bytea", "bytea"]]],
  ["byteage", [["bytea", "bytea"]]],
  ["byteagt", [["bytea", "bytea"]]],
  ["byteale", [["bytea", "bytea"]]],
  ["bytealt", [["bytea", "bytea"]]],
  ["byteane", [["bytea", "bytea"]]],
  ["chareq", [["char", "char"]]],
  ["charge", [["char", "char"]]],
  ["chargt", [["char", "char"]]],
  ["charle", [["char", "char"]]],
  ["charlt", [["char", "char"]]],
  ["charne", [["char", "char"]]],
  ["date_eq", [["date", "date"]]],
  ["date_ge", [["date", "date"]]],
  ["date_gt", [["date", "date"]]],
  ["date_le", [["date", "date"]]],
  ["date_lt", [["date", "date"]]],
  ["date_ne", [["date", "date"]]],
  ["float4eq", [["float4", "float4"]]],
  ["float4ge", [["float4", "float4"]]],
  ["float4gt", [["float4", "float4"]]],
  ["float4le", [["float4", "float4"]]],
  ["float4lt", [["float4", "float4"]]],
  ["float4ne", [["float4", "float4"]]],
  ["float8eq", [["float8", "float8"]]],
  ["float8ge", [["float8", "float8"]]],
  ["float8gt", [["float8", "float8"]]],
  ["float8le", [["float8", "float8"]]],
  ["float8lt", [["float8", "float8"]]],
  ["float8ne", [["float8", "float8"]]],
  ["int2eq", [["int2", "int2"]]],
  ["int2ge", [["int2", "int2"]]],
  ["int2gt", [["int2", "int2"]]],
  ["int2le", [["int2", "int2"]]],
  ["int2lt", [["int2", "int2"]]],
  ["int2pl", [["int2", "int2"]]],
  ["int2mi", [["int2", "int2"]]],
  ["int2mul", [["int2", "int2"]]],
  ["int2div", [["int2", "int2"]]],
  ["int2ne", [["int2", "int2"]]],
  ["int2um", [["int2"]]],
  ["int24eq", [["int2", "int4"]]],
  ["int24ge", [["int2", "int4"]]],
  ["int24gt", [["int2", "int4"]]],
  ["int24le", [["int2", "int4"]]],
  ["int24lt", [["int2", "int4"]]],
  ["int24ne", [["int2", "int4"]]],
  ["int28eq", [["int2", "int8"]]],
  ["int28ge", [["int2", "int8"]]],
  ["int28gt", [["int2", "int8"]]],
  ["int28le", [["int2", "int8"]]],
  ["int28lt", [["int2", "int8"]]],
  ["int28ne", [["int2", "int8"]]],
  ["int4eq", [["int4", "int4"]]],
  ["int4ge", [["int4", "int4"]]],
  ["int4gt", [["int4", "int4"]]],
  ["int4le", [["int4", "int4"]]],
  ["int4lt", [["int4", "int4"]]],
  ["int4pl", [["int4", "int4"]]],
  ["int4mi", [["int4", "int4"]]],
  ["int4mul", [["int4", "int4"]]],
  ["int4div", [["int4", "int4"]]],
  ["int4ne", [["int4", "int4"]]],
  ["int4um", [["int4"]]],
  ["int42eq", [["int4", "int2"]]],
  ["int42ge", [["int4", "int2"]]],
  ["int42gt", [["int4", "int2"]]],
  ["int42le", [["int4", "int2"]]],
  ["int42lt", [["int4", "int2"]]],
  ["int42ne", [["int4", "int2"]]],
  ["int48eq", [["int4", "int8"]]],
  ["int48ge", [["int4", "int8"]]],
  ["int48gt", [["int4", "int8"]]],
  ["int48le", [["int4", "int8"]]],
  ["int48lt", [["int4", "int8"]]],
  ["int48ne", [["int4", "int8"]]],
  ["int8eq", [["int8", "int8"]]],
  ["int8ge", [["int8", "int8"]]],
  ["int8gt", [["int8", "int8"]]],
  ["int8le", [["int8", "int8"]]],
  ["int8lt", [["int8", "int8"]]],
  ["int8pl", [["int8", "int8"]]],
  ["int8mi", [["int8", "int8"]]],
  ["int8mul", [["int8", "int8"]]],
  ["int8div", [["int8", "int8"]]],
  ["int8ne", [["int8", "int8"]]],
  ["int8um", [["int8"]]],
  ["int82eq", [["int8", "int2"]]],
  ["int82ge", [["int8", "int2"]]],
  ["int82gt", [["int8", "int2"]]],
  ["int82le", [["int8", "int2"]]],
  ["int82lt", [["int8", "int2"]]],
  ["int82ne", [["int8", "int2"]]],
  ["int84eq", [["int8", "int4"]]],
  ["int84ge", [["int8", "int4"]]],
  ["int84gt", [["int8", "int4"]]],
  ["int84le", [["int8", "int4"]]],
  ["int84lt", [["int8", "int4"]]],
  ["int84ne", [["int8", "int4"]]],
  ["interval_eq", [["interval", "interval"]]],
  ["interval_ge", [["interval", "interval"]]],
  ["interval_gt", [["interval", "interval"]]],
  ["interval_le", [["interval", "interval"]]],
  ["interval_lt", [["interval", "interval"]]],
  ["interval_ne", [["interval", "interval"]]],
  ["jsonb_eq", [["jsonb", "jsonb"]]],
  ["jsonb_ge", [["jsonb", "jsonb"]]],
  ["jsonb_gt", [["jsonb", "jsonb"]]],
  ["jsonb_le", [["jsonb", "jsonb"]]],
  ["jsonb_lt", [["jsonb", "jsonb"]]],
  ["jsonb_ne", [["jsonb", "jsonb"]]],
  ["jsonb_contains", [["jsonb", "jsonb"]]],
  ["jsonb_contained", [["jsonb", "jsonb"]]],
  ["jsonb_exists", [["jsonb", "text"]]],
  ["jsonb_exists_all", [["jsonb", "text[]"]]],
  ["jsonb_exists_any", [["jsonb", "text[]"]]],
  ["macaddr_eq", [["macaddr", "macaddr"]]],
  ["macaddr_ge", [["macaddr", "macaddr"]]],
  ["macaddr_gt", [["macaddr", "macaddr"]]],
  ["macaddr_le", [["macaddr", "macaddr"]]],
  ["macaddr_lt", [["macaddr", "macaddr"]]],
  ["macaddr_ne", [["macaddr", "macaddr"]]],
  ["macaddr8_eq", [["macaddr8", "macaddr8"]]],
  ["macaddr8_ge", [["macaddr8", "macaddr8"]]],
  ["macaddr8_gt", [["macaddr8", "macaddr8"]]],
  ["macaddr8_le", [["macaddr8", "macaddr8"]]],
  ["macaddr8_lt", [["macaddr8", "macaddr8"]]],
  ["macaddr8_ne", [["macaddr8", "macaddr8"]]],
  ["nameeq", [["name", "name"]]],
  ["namege", [["name", "name"]]],
  ["namegt", [["name", "name"]]],
  ["namele", [["name", "name"]]],
  ["namelt", [["name", "name"]]],
  ["namene", [["name", "name"]]],
  ["network_eq", [["inet", "inet"]]],
  ["network_ge", [["inet", "inet"]]],
  ["network_gt", [["inet", "inet"]]],
  ["network_le", [["inet", "inet"]]],
  ["network_lt", [["inet", "inet"]]],
  ["network_ne", [["inet", "inet"]]],
  [
    "network_overlap",
    [
      ["inet", "inet"],
      ["cidr", "cidr"],
    ],
  ],
  [
    "network_sub",
    [
      ["inet", "inet"],
      ["cidr", "cidr"],
    ],
  ],
  [
    "network_subeq",
    [
      ["inet", "inet"],
      ["cidr", "cidr"],
    ],
  ],
  [
    "network_sup",
    [
      ["inet", "inet"],
      ["cidr", "cidr"],
    ],
  ],
  [
    "network_supeq",
    [
      ["inet", "inet"],
      ["cidr", "cidr"],
    ],
  ],
  ["numeric_add", [["numeric", "numeric"]]],
  ["numeric_div", [["numeric", "numeric"]]],
  ["numeric_eq", [["numeric", "numeric"]]],
  ["numeric_ge", [["numeric", "numeric"]]],
  ["numeric_gt", [["numeric", "numeric"]]],
  ["numeric_le", [["numeric", "numeric"]]],
  ["numeric_lt", [["numeric", "numeric"]]],
  ["numeric_mod", [["numeric", "numeric"]]],
  ["numeric_mul", [["numeric", "numeric"]]],
  ["numeric_ne", [["numeric", "numeric"]]],
  ["numeric_sub", [["numeric", "numeric"]]],
  ["numeric_uplus", [["numeric"]]],
  ["numeric_uminus", [["numeric"]]],
  ["oideq", [["oid", "oid"]]],
  ["oidge", [["oid", "oid"]]],
  ["oidgt", [["oid", "oid"]]],
  ["oidle", [["oid", "oid"]]],
  ["oidlt", [["oid", "oid"]]],
  ["oidne", [["oid", "oid"]]],
  ["oidvectoreq", [["oidvector", "oidvector"]]],
  ["oidvectorge", [["oidvector", "oidvector"]]],
  ["oidvectorgt", [["oidvector", "oidvector"]]],
  ["oidvectorle", [["oidvector", "oidvector"]]],
  ["oidvectorlt", [["oidvector", "oidvector"]]],
  ["oidvectorne", [["oidvector", "oidvector"]]],
  ["record_eq", [["record", "record"]]],
  ["record_ge", [["record", "record"]]],
  ["record_gt", [["record", "record"]]],
  ["record_le", [["record", "record"]]],
  ["record_lt", [["record", "record"]]],
  ["record_ne", [["record", "record"]]],
  ["textcat", [["text", "text"]]],
  ["texteq", [["text", "text"]]],
  ["text_ge", [["text", "text"]]],
  ["text_gt", [["text", "text"]]],
  ["text_le", [["text", "text"]]],
  ["text_lt", [["text", "text"]]],
  ["textne", [["text", "text"]]],
  ["tideq", [["tid", "tid"]]],
  ["tidge", [["tid", "tid"]]],
  ["tidgt", [["tid", "tid"]]],
  ["tidle", [["tid", "tid"]]],
  ["tidlt", [["tid", "tid"]]],
  ["tidne", [["tid", "tid"]]],
  ["time_eq", [["time", "time"]]],
  ["time_ge", [["time", "time"]]],
  ["time_gt", [["time", "time"]]],
  ["time_le", [["time", "time"]]],
  ["time_lt", [["time", "time"]]],
  ["time_ne", [["time", "time"]]],
  ["timestamp_eq", [["timestamp", "timestamp"]]],
  ["timestamp_ge", [["timestamp", "timestamp"]]],
  ["timestamp_gt", [["timestamp", "timestamp"]]],
  ["timestamp_le", [["timestamp", "timestamp"]]],
  ["timestamp_lt", [["timestamp", "timestamp"]]],
  ["timestamp_ne", [["timestamp", "timestamp"]]],
  ["timestamptz_eq", [["timestamptz", "timestamptz"]]],
  ["timestamptz_ge", [["timestamptz", "timestamptz"]]],
  ["timestamptz_gt", [["timestamptz", "timestamptz"]]],
  ["timestamptz_le", [["timestamptz", "timestamptz"]]],
  ["timestamptz_lt", [["timestamptz", "timestamptz"]]],
  ["timestamptz_ne", [["timestamptz", "timestamptz"]]],
  ["timetz_eq", [["timetz", "timetz"]]],
  ["timetz_ge", [["timetz", "timetz"]]],
  ["timetz_gt", [["timetz", "timetz"]]],
  ["timetz_le", [["timetz", "timetz"]]],
  ["timetz_lt", [["timetz", "timetz"]]],
  ["timetz_ne", [["timetz", "timetz"]]],
  ["tsquery_eq", [["tsquery", "tsquery"]]],
  ["tsquery_ge", [["tsquery", "tsquery"]]],
  ["tsquery_gt", [["tsquery", "tsquery"]]],
  ["tsquery_le", [["tsquery", "tsquery"]]],
  ["tsquery_lt", [["tsquery", "tsquery"]]],
  ["tsquery_ne", [["tsquery", "tsquery"]]],
  ["tsvector_eq", [["tsvector", "tsvector"]]],
  ["tsvector_ge", [["tsvector", "tsvector"]]],
  ["tsvector_gt", [["tsvector", "tsvector"]]],
  ["tsvector_le", [["tsvector", "tsvector"]]],
  ["tsvector_lt", [["tsvector", "tsvector"]]],
  ["tsvector_ne", [["tsvector", "tsvector"]]],
  ["uuid_eq", [["uuid", "uuid"]]],
  ["uuid_ge", [["uuid", "uuid"]]],
  ["uuid_gt", [["uuid", "uuid"]]],
  ["uuid_le", [["uuid", "uuid"]]],
  ["uuid_lt", [["uuid", "uuid"]]],
  ["uuid_ne", [["uuid", "uuid"]]],
  ["varbiteq", [["varbit", "varbit"]]],
  ["varbitge", [["varbit", "varbit"]]],
  ["varbitgt", [["varbit", "varbit"]]],
  ["varbitle", [["varbit", "varbit"]]],
  ["varbitlt", [["varbit", "varbit"]]],
  ["varbitne", [["varbit", "varbit"]]],
  ["xid8eq", [["xid8", "xid8"]]],
  ["xid8ge", [["xid8", "xid8"]]],
  ["xid8gt", [["xid8", "xid8"]]],
  ["xid8le", [["xid8", "xid8"]]],
  ["xid8lt", [["xid8", "xid8"]]],
  ["xid8ne", [["xid8", "xid8"]]],
]);

const operatorEstimatorFunctionArgs = (
  optionName: string,
): ObjectRef[] | null => {
  if (optionName === "restrict") {
    return [
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "oid"),
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "int4"),
    ];
  }

  if (optionName === "join") {
    return [
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "oid"),
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "int2"),
      createObjectRefFromAst("type", "internal"),
    ];
  }

  return null;
};

const isBuiltInOperatorEstimatorFunctionName = (
  nameParts: string[],
  optionName: string,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  const builtInNames = builtInEstimatorFunctionNamesByOption.get(optionName);
  if (!name || builtInNames?.has(name) !== true) {
    return false;
  }

  return (
    nameParts.length === 1 ||
    (nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  );
};

const isBuiltInOperatorImplementationFunctionName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name) {
    return false;
  }
  const builtInSignatures =
    builtInOperatorImplementationFunctionSignatures.get(name);
  if (!builtInSignatures) {
    return false;
  }
  if (
    nameParts.length !== 1 &&
    !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  ) {
    return false;
  }

  return builtInSignatures.some(
    (signature) =>
      args.length === signature.length &&
      signature.every((typeName, index) =>
        typeRefMatchesBuiltInNames(args[index] ?? null, [typeName]),
      ),
  );
};

const booleanBuiltInOperatorImplementationNames = new Set([
  "array_eq",
  "arraycontained",
  "arraycontains",
  "arrayoverlap",
  "jsonb_contained",
  "jsonb_contains",
  "jsonb_exists",
  "jsonb_exists_all",
  "jsonb_exists_any",
  "network_overlap",
  "network_sub",
  "network_subeq",
  "network_sup",
  "network_supeq",
]);

const builtInOperatorImplementationReturnsBool = (name: string): boolean =>
  /(?:eq|ne|lt|le|gt|ge)$/.test(name) ||
  booleanBuiltInOperatorImplementationNames.has(name);

const builtInOperatorImplementationReturnType = (
  functionRef: ObjectRef,
  argsSignature: string,
): string | null => {
  if (
    functionRef.kind !== "function" ||
    (functionRef.schema !== DEFAULT_SCHEMA &&
      functionRef.schema !== "pg_catalog")
  ) {
    return null;
  }

  const name = functionRef.name.toLowerCase();
  const builtInSignatures =
    builtInOperatorImplementationFunctionSignatures.get(name);
  if (!builtInSignatures || !builtInOperatorImplementationReturnsBool(name)) {
    return null;
  }

  for (const signature of builtInSignatures) {
    if (
      signaturesCompatible(argsSignature, `(${signature.join(",")})`, {
        requireExactArity: true,
      })
    ) {
      return "bool";
    }
  }
  return null;
};

const addInvalidPgCatalogTypeDiagnostic = (
  diagnostics: Diagnostic[],
  typeRef: ObjectRef,
  message: string,
  suggestedFix: string,
): void => {
  if (isPgCatalogRef(typeRef) && !isKnownPgCatalogTypeRef(typeRef)) {
    diagnostics.push(
      unresolvedCatalogDiagnostic(message, typeRef, suggestedFix),
    );
  }
};

const extractCreateOperatorDependencies = (
  statementNode: Record<string, unknown>,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const diagnostics: Diagnostic[] = [];

  const operatorRef = objectFromNameParts(
    "operator",
    extractNameParts(statementNode.defnames),
  );
  if (operatorRef?.schema) {
    requires.push(createObjectRefFromAst("schema", operatorRef.schema));
  }

  const definition = Array.isArray(statementNode.definition)
    ? statementNode.definition
    : [];
  let functionNameParts: string[] = [];
  let leftArgRef: ObjectRef | null = null;
  let rightArgRef: ObjectRef | null = null;

  for (const optionNode of definition) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }

    const optionName = defElem.defname.toLowerCase();
    const typeName = asRecord(defElem.arg)?.TypeName;
    if (operatorImplementationFunctionOptionNames.has(optionName)) {
      functionNameParts = extractNameParts(asRecord(typeName)?.names);
      continue;
    }

    if (operatorEstimatorFunctionOptionNames.has(optionName)) {
      const estimatorFunctionNameParts = extractNameParts(
        asRecord(typeName)?.names,
      );
      const estimatorFunctionRef = objectRefFromNamePartsWithArgs(
        "function",
        estimatorFunctionNameParts,
        operatorEstimatorFunctionArgs(optionName) ?? [],
      );
      if (estimatorFunctionRef) {
        const estimatorFunctionArgs =
          operatorEstimatorFunctionArgs(optionName) ?? [];
        const estimatorFunctionWithReturnRef = createObjectRefFromAst(
          "function",
          estimatorFunctionRef.name,
          estimatorFunctionRef.schema,
          typeRefsSignature(
            estimatorFunctionArgs,
            createObjectRefFromAst("type", "float8"),
          ),
        );
        const exactEstimatorFunctionRef = markExactKindRef(
          markExactSignatureRef(estimatorFunctionWithReturnRef),
        );
        if (
          isBuiltInOperatorEstimatorFunctionName(
            estimatorFunctionNameParts,
            optionName,
          )
        ) {
          if (estimatorFunctionNameParts.length === 1) {
            requires.push(
              markOmitIfNoLocalProducerRef(exactEstimatorFunctionRef),
            );
          }
          continue;
        }

        requires.push(exactEstimatorFunctionRef);
        if (isPgCatalogQualifiedName(estimatorFunctionNameParts)) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            message: `No valid pg_catalog operator estimator '${estimatorFunctionRef.name}' found for option '${optionName}'.`,
            objectRefs: [exactEstimatorFunctionRef],
            suggestedFix:
              "Use a pg_catalog estimator whose signature matches the selected RESTRICT or JOIN option.",
          });
        }
      }
      continue;
    }

    if (operatorLinkOptionNames.has(optionName)) {
      const linkedOperatorNameParts = extractNameParts(
        asRecord(asRecord(defElem.arg)?.List)?.items,
      );
      if (linkedOperatorNameParts.length > 1) {
        const schemaName = linkedOperatorNameParts.slice(0, -1).join(".");
        if (!isBuiltInSchemaName(schemaName)) {
          requires.push(createObjectRefFromAst("schema", schemaName));
        }
      }
      continue;
    }

    if (optionName === "leftarg") {
      leftArgRef = typeFromTypeNameNode(typeName);
      if (leftArgRef) {
        requires.push(leftArgRef);
        addInvalidPgCatalogTypeDiagnostic(
          diagnostics,
          leftArgRef,
          `No pg_catalog operator argument type '${leftArgRef.name}' found.`,
          "Use an existing pg_catalog type or create the referenced argument type explicitly in a user schema.",
        );
      }
      continue;
    }

    if (optionName === "rightarg") {
      rightArgRef = typeFromTypeNameNode(typeName);
      if (rightArgRef) {
        requires.push(rightArgRef);
        addInvalidPgCatalogTypeDiagnostic(
          diagnostics,
          rightArgRef,
          `No pg_catalog operator argument type '${rightArgRef.name}' found.`,
          "Use an existing pg_catalog type or create the referenced argument type explicitly in a user schema.",
        );
      }
    }
  }

  const operatorArgRefs = [leftArgRef, rightArgRef].filter(
    (argRef): argRef is ObjectRef => argRef !== null,
  );
  const functionArgRefs = operatorArgRefs.map(catalogQualifiedBuiltInTypeRef);
  const functionSignatureParts = functionArgRefs.map(typeSignaturePart);
  const functionArgsSignature =
    functionSignatureParts.length > 0
      ? `(${functionSignatureParts.join(",")})`
      : undefined;
  const operatorSignatureParts =
    leftArgRef || rightArgRef
      ? [
          leftArgRef ? typeSignaturePart(leftArgRef) : "none",
          rightArgRef ? typeSignaturePart(rightArgRef) : "none",
        ]
      : [];

  if (operatorRef) {
    const operatorArgsSignature =
      operatorSignatureParts.length > 0
        ? `(${operatorSignatureParts.join(",")})`
        : undefined;
    provides.push(
      createObjectRefFromAst(
        "operator",
        operatorRef.name,
        operatorRef.schema,
        operatorArgsSignature,
      ),
    );
    const functionRef = objectFromNameParts("function", functionNameParts);
    const returnTypeSignature = functionRef
      ? routineReturnTypeSignaturePart(
          context,
          functionRef,
          functionArgsSignature,
        )
      : null;
    if (operatorArgsSignature && returnTypeSignature) {
      provides.push(
        createObjectRefFromAst(
          "operator",
          operatorRef.name,
          operatorRef.schema,
          `${operatorArgsSignature}->${returnTypeSignature}`,
        ),
      );
    }
  }

  const functionRef = objectFromNameParts("function", functionNameParts);
  if (functionRef) {
    const exactFunctionRef = markExactKindRef(
      markExactSignatureRef(
        createObjectRefFromAst(
          "function",
          functionRef.name,
          functionRef.schema,
          functionSignatureParts.length > 0
            ? `(${functionSignatureParts.join(",")})`
            : undefined,
        ),
      ),
    );

    if (
      isBuiltInOperatorImplementationFunctionName(
        functionNameParts,
        functionArgRefs,
      )
    ) {
      if (functionNameParts.length === 1) {
        requires.push(markOmitIfNoLocalProducerRef(exactFunctionRef));
      }
    } else {
      requires.push(exactFunctionRef);
      if (isPgCatalogQualifiedName(functionNameParts)) {
        diagnostics.push({
          code: "UNRESOLVED_DEPENDENCY",
          message: `No valid pg_catalog operator implementation function '${functionRef.name}' found for operator signature '${exactFunctionRef.signature ?? "unknown"}'.`,
          objectRefs: [exactFunctionRef],
          suggestedFix:
            "Use a pg_catalog operator implementation function whose arguments match the declared operator arguments.",
        });
      }
    }
  }

  return { provides, requires, diagnostics };
};

const OPCLASS_ITEM_OPERATOR = 1;
const OPCLASS_ITEM_FUNCTION = 2;
const OPCLASS_ITEM_STORAGE = 3;

const extractCreateOperatorFamilyDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const accessMethod =
    typeof statementNode.amname === "string" ? statementNode.amname : "";

  const operatorFamilyRef = objectFromNameParts(
    "operator_family",
    extractNameParts(statementNode.opfamilyname),
  );
  if (operatorFamilyRef) {
    provides.push(
      createObjectRefFromAst(
        "operator_family",
        operatorFamilyRef.name,
        operatorFamilyRef.schema,
        operatorFamilySignature(accessMethod),
      ),
    );
    if (operatorFamilyRef.schema) {
      requires.push(createObjectRefFromAst("schema", operatorFamilyRef.schema));
    }
  }
  addAccessMethodDependencyIfNeeded(accessMethod, requires, "index");

  return { provides, requires };
};

const extractCreateAccessMethodDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const accessMethodKind = accessMethodKindFromAmType(statementNode.amtype);
  if (typeof statementNode.amname === "string") {
    provides.push(accessMethodRef(statementNode.amname));
    if (accessMethodKind !== null) {
      provides.push(accessMethodRef(statementNode.amname, accessMethodKind));
    }
  }

  const handlerRef = objectFromNameParts(
    "function",
    extractNameParts(statementNode.handler_name),
  );
  if (handlerRef) {
    const handlerNameParts = extractNameParts(statementNode.handler_name);
    const handlerReturnType =
      accessMethodKind === null
        ? null
        : createObjectRefFromAst(
            "type",
            accessMethodKind === "index"
              ? "index_am_handler"
              : "table_am_handler",
          );
    const exactHandlerRef = markExactKindRef(
      markExactSignatureRef(
        createObjectRefFromAst(
          "function",
          handlerRef.name,
          handlerRef.schema,
          typeRefsSignature(
            [createObjectRefFromAst("type", "internal")],
            handlerReturnType,
          ),
        ),
      ),
    );
    if (isBuiltInAccessMethodHandlerName(handlerNameParts, accessMethodKind)) {
      if (handlerNameParts.length === 1) {
        requires.push(markOmitIfNoLocalProducerRef(exactHandlerRef));
      }
    } else {
      requires.push(exactHandlerRef);
    }
    if (handlerRef.schema) {
      requires.push(createObjectRefFromAst("schema", handlerRef.schema));
    }
  }

  return { provides, requires };
};

const extractCreateOperatorClassDependencies = (
  statementNode: Record<string, unknown>,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const diagnostics: Diagnostic[] = [];
  const accessMethod =
    typeof statementNode.amname === "string" ? statementNode.amname : "";
  const operatorFamilyNameParts = extractNameParts(statementNode.opfamilyname);
  const operatorFamilyRef = objectFromNameParts(
    "operator_family",
    operatorFamilyNameParts,
  );
  const dataTypeRef = typeFromTypeNameNode(statementNode.datatype);
  addAccessMethodDependencyIfNeeded(accessMethod, requires, "index");

  const operatorClassRef = objectFromNameParts(
    "operator_class",
    extractNameParts(statementNode.opclassname),
  );
  if (operatorClassRef) {
    provides.push(
      createObjectRefFromAst(
        "operator_class",
        operatorClassRef.name,
        operatorClassRef.schema,
        operatorClassSignature(accessMethod, dataTypeRef),
      ),
    );
    provides.push(
      createObjectRefFromAst(
        "operator_class",
        operatorClassRef.name,
        operatorClassRef.schema,
        operatorClassIdentitySignature(accessMethod),
      ),
    );
    if (!operatorFamilyRef) {
      provides.push(
        markImplicitProviderRef(
          createObjectRefFromAst(
            "operator_family",
            operatorClassRef.name,
            operatorClassRef.schema,
            operatorFamilySignature(accessMethod),
          ),
        ),
      );
    }
    if (operatorClassRef.schema) {
      requires.push(createObjectRefFromAst("schema", operatorClassRef.schema));
    }
  }

  if (operatorFamilyRef) {
    // CREATE OPERATOR CLASS ... FAMILY requires the named family to exist for
    // the same access method before the class can be created.
    const operatorFamilyRequirement = createObjectRefFromAst(
      "operator_family",
      operatorFamilyRef.name,
      operatorFamilyRef.schema,
      operatorFamilySignature(accessMethod),
    );
    if (
      !isBuiltInOperatorFamilyNameForAccessMethod(
        operatorFamilyNameParts,
        accessMethod,
      )
    ) {
      requires.push(
        isUnqualifiedBuiltInOperatorFamilyNameForAccessMethod(
          operatorFamilyNameParts,
          accessMethod,
        )
          ? markOmitIfNoLocalProducerRef(operatorFamilyRequirement)
          : operatorFamilyRequirement,
      );
      if (operatorFamilyRef.schema?.toLowerCase() === "pg_catalog") {
        diagnostics.push({
          code: "UNRESOLVED_DEPENDENCY",
          message: `No pg_catalog operator family '${operatorFamilyRef.name}' found for access method '${accessMethod || "unknown"}'.`,
          objectRefs: [operatorFamilyRequirement],
          suggestedFix:
            "Use an operator family for the selected access method or create one explicitly.",
        });
      }
    }
  }

  if (dataTypeRef) {
    requires.push(dataTypeRef);
    addInvalidPgCatalogTypeDiagnostic(
      diagnostics,
      dataTypeRef,
      `No pg_catalog operator class data type '${dataTypeRef.name}' found.`,
      "Use an existing pg_catalog type or create the referenced operator class data type explicitly in a user schema.",
    );
  }

  const items = Array.isArray(statementNode.items) ? statementNode.items : [];
  for (const itemNode of items) {
    const item = asRecord(asRecord(itemNode)?.CreateOpClassItem);
    if (!item) {
      continue;
    }

    const itemName = asRecord(item.name);
    const nameParts = extractNameParts(itemName?.objname);
    const itemNumber = typeof item.number === "number" ? item.number : -1;

    if (item.itemtype === OPCLASS_ITEM_OPERATOR) {
      const explicitOperatorArgs = objectWithArgsTypeRefs(itemName, {
        preserveOperatorNone: true,
      });
      for (const argRef of explicitOperatorArgs) {
        if (argRef && !isOperatorNoneArgRef(argRef)) {
          requires.push(argRef);
          addInvalidPgCatalogTypeDiagnostic(
            diagnostics,
            argRef,
            `No pg_catalog support operator argument type '${argRef.name}' found for operator class.`,
            "Use an existing pg_catalog type or create the referenced support operator argument type explicitly in a user schema.",
          );
        }
      }
      const operatorArgs =
        explicitOperatorArgs.length > 0
          ? explicitOperatorArgs
          : dataTypeRef
            ? [dataTypeRef, dataTypeRef]
            : [];

      const orderFamilyRef = objectFromNameParts(
        "operator_family",
        extractNameParts(item.order_family),
      );
      const isOrderingOperator = Boolean(orderFamilyRef);
      const orderFamilyNameParts = extractNameParts(item.order_family);
      const orderFamilyReturnType = orderByOperatorReturnType(
        orderFamilyNameParts,
        orderFamilyRef,
        context,
      );
      if (orderFamilyRef) {
        const orderFamilyRequirement = createObjectRefFromAst(
          "operator_family",
          orderFamilyRef.name,
          orderFamilyRef.schema,
          "(btree)",
        );
        if (!isBuiltInBtreeOperatorFamilyName(orderFamilyNameParts)) {
          requires.push(
            isUnqualifiedBuiltInBtreeOperatorFamilyName(orderFamilyNameParts)
              ? markOmitIfNoLocalProducerRef(orderFamilyRequirement)
              : orderFamilyRequirement,
          );
          if (orderFamilyRef.schema?.toLowerCase() === "pg_catalog") {
            diagnostics.push({
              code: "UNRESOLVED_DEPENDENCY",
              message: `No pg_catalog btree operator family '${orderFamilyRef.name}' found for ORDER BY support.`,
              objectRefs: [orderFamilyRequirement],
              suggestedFix:
                "Use a valid pg_catalog btree operator family or create the operator family explicitly in a user schema.",
            });
          }
        }
      }

      const exactReturnOperatorRefFor = (
        operatorRef: ObjectRef,
      ): ObjectRef | null =>
        operatorRef.signature && (!isOrderingOperator || orderFamilyReturnType)
          ? markExactSignatureRef(
              createObjectRefFromAst(
                "operator",
                operatorRef.name,
                operatorRef.schema,
                `${operatorRef.signature}->${typeSignaturePart(
                  orderFamilyReturnType ??
                    createObjectRefFromAst("type", "bool"),
                )}`,
              ),
            )
          : null;

      if (
        isBuiltInOperatorClassSupportOperatorName(
          nameParts,
          operatorArgs,
          dataTypeRef,
          accessMethod,
          itemNumber,
          context,
        )
      ) {
        if (nameParts.length === 1) {
          const operatorRef = objectWithArgsRef(
            "operator",
            itemName,
            operatorArgs,
            { preserveOperatorNone: true },
          );
          if (operatorRef) {
            requires.push(markOmitIfNoLocalProducerRef(operatorRef));
            const exactReturnOperatorRef =
              exactReturnOperatorRefFor(operatorRef);
            if (exactReturnOperatorRef) {
              requires.push(
                markOmitIfNoLocalProducerRef(exactReturnOperatorRef),
              );
            }
          }
        }
        continue;
      }

      const operatorRef = objectWithArgsRef(
        "operator",
        itemName,
        operatorArgs,
        {
          preserveOperatorNone: true,
        },
      );
      if (operatorRef) {
        requires.push(operatorRef);
        const exactReturnOperatorRef = exactReturnOperatorRefFor(operatorRef);
        if (exactReturnOperatorRef) {
          requires.push(markOmitIfNoLocalProducerRef(exactReturnOperatorRef));
        }
        if (isPgCatalogQualifiedName(nameParts)) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            message: `No valid pg_catalog support operator '${operatorRef.name}' found for access method '${accessMethod || "unknown"}' strategy number ${itemNumber}.`,
            objectRefs: [operatorRef],
            suggestedFix:
              "Use a pg_catalog support operator that matches the selected access method, strategy number, and argument signature.",
          });
        }
      }
      continue;
    }

    if (item.itemtype === OPCLASS_ITEM_FUNCTION) {
      const classArgs = Array.isArray(item.class_args) ? item.class_args : [];
      const classArgRefs: ObjectRef[] = [];
      for (const classArg of classArgs) {
        const classArgRef = typeFromTypeNameNode(asRecord(classArg)?.TypeName);
        if (classArgRef) {
          classArgRefs.push(classArgRef);
          requires.push(classArgRef);
          addInvalidPgCatalogTypeDiagnostic(
            diagnostics,
            classArgRef,
            `No pg_catalog support function class argument type '${classArgRef.name}' found for operator class.`,
            "Use an existing pg_catalog type or create the referenced support function class argument type explicitly in a user schema.",
          );
        }
      }

      const explicitFunctionArgs = objectWithArgsTypeRefs(itemName);
      for (const functionArgRef of explicitFunctionArgs) {
        if (functionArgRef) {
          requires.push(functionArgRef);
          addInvalidPgCatalogTypeDiagnostic(
            diagnostics,
            functionArgRef,
            `No pg_catalog support function argument type '${functionArgRef.name}' found for operator class.`,
            "Use an existing pg_catalog type or create the referenced support function argument type explicitly in a user schema.",
          );
        }
      }
      const functionArgs =
        explicitFunctionArgs.length > 0
          ? explicitFunctionArgs
          : inferredOperatorClassSupportFunctionArgs(
              accessMethod,
              itemNumber,
              dataTypeRef,
              classArgRefs,
            );
      const functionReturnType = operatorClassSupportFunctionReturnType(
        accessMethod,
        itemNumber,
      );
      if (
        isBuiltInOperatorClassSupportFunctionName(
          nameParts,
          functionArgs,
          accessMethod,
          itemNumber,
          dataTypeRef,
          classArgRefs,
          context,
        )
      ) {
        if (nameParts.length === 1) {
          const functionRef = objectWithArgsRef(
            "function",
            itemName,
            functionArgs,
          );
          if (functionRef) {
            const functionWithReturnRef = createObjectRefFromAst(
              "function",
              functionRef.name,
              functionRef.schema,
              typeRefsSignature(functionArgs, functionReturnType),
            );
            requires.push(
              markOmitIfNoLocalProducerRef(
                markExactKindRef(markExactSignatureRef(functionWithReturnRef)),
              ),
            );
          }
        }
        continue;
      }

      const functionRef = objectWithArgsRef("function", itemName, functionArgs);
      if (functionRef) {
        const functionWithReturnRef = createObjectRefFromAst(
          "function",
          functionRef.name,
          functionRef.schema,
          typeRefsSignature(functionArgs, functionReturnType),
        );
        const exactFunctionRef = markExactKindRef(
          markExactSignatureRef(functionWithReturnRef),
        );
        requires.push(exactFunctionRef);
        if (isPgCatalogQualifiedName(nameParts)) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            message: `No valid pg_catalog support function '${functionRef.name}' found for access method '${accessMethod || "unknown"}' support number ${itemNumber}.`,
            objectRefs: [exactFunctionRef],
            suggestedFix:
              "Use a pg_catalog support routine that matches the selected access method, support number, and argument signature.",
          });
        }
      }
      continue;
    }

    if (item.itemtype === OPCLASS_ITEM_STORAGE) {
      const storageTypeRef = typeFromTypeNameNode(item.storedtype);
      if (storageTypeRef) {
        requires.push(storageTypeRef);
        if (
          isPgCatalogRef(storageTypeRef) &&
          !isKnownPgCatalogTypeRef(storageTypeRef)
        ) {
          diagnostics.push(
            unresolvedCatalogDiagnostic(
              `No pg_catalog storage type '${storageTypeRef.name}' found for operator class.`,
              storageTypeRef,
              "Use an existing pg_catalog storage type or create the referenced type explicitly in a user schema.",
            ),
          );
        }
      }
    }
  }

  return { provides, requires, diagnostics };
};

const baseTypeFunctionArgAlternatives = (
  optionName: string,
  typeRef: ObjectRef | null,
): ObjectRef[][] => {
  if (!typeRef) {
    return [];
  }

  if (optionName === "input") {
    return [
      [createObjectRefFromAst("type", "cstring")],
      [
        createObjectRefFromAst("type", "cstring"),
        createObjectRefFromAst("type", "oid"),
        createObjectRefFromAst("type", "int4"),
      ],
    ];
  }

  if (optionName === "output") {
    return [[typeRef]];
  }

  if (optionName === "receive") {
    return [
      [createObjectRefFromAst("type", "internal")],
      [
        createObjectRefFromAst("type", "internal"),
        createObjectRefFromAst("type", "oid"),
        createObjectRefFromAst("type", "int4"),
      ],
    ];
  }

  if (optionName === "send") {
    return [[typeRef]];
  }

  if (optionName === "typmod_in") {
    return [[createObjectRefFromAst("type", "cstring[]")]];
  }

  if (optionName === "typmod_out") {
    return [[createObjectRefFromAst("type", "int4")]];
  }

  if (optionName === "analyze" || optionName === "subscript") {
    return [[createObjectRefFromAst("type", "internal")]];
  }

  return [];
};

const baseTypeFunctionReturnType = (
  optionName: string,
  typeRef: ObjectRef | null,
): ObjectRef | null => {
  if (optionName === "input" || optionName === "receive") {
    return typeRef;
  }

  if (optionName === "output" || optionName === "typmod_out") {
    return createObjectRefFromAst("type", "cstring");
  }

  if (optionName === "send") {
    return createObjectRefFromAst("type", "bytea");
  }

  if (optionName === "typmod_in") {
    return createObjectRefFromAst("type", "int4");
  }

  if (optionName === "analyze") {
    return createObjectRefFromAst("type", "bool");
  }

  if (optionName === "subscript") {
    return createObjectRefFromAst("type", "internal");
  }

  return null;
};

const extractCreateBaseTypeDependencies = (
  statementNode: Record<string, unknown>,
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const diagnostics: Diagnostic[] = [];

  const typeRef = objectFromNameParts(
    "type",
    extractNameParts(statementNode.defnames),
  );
  if (typeRef) {
    provides.push(...typeProviderRefs(typeRef, context));
    addImplicitArrayCollisionDependency(typeRef, requires, context);
    requires.push(
      markOmitIfNoLocalProducerRef(
        createObjectRefFromAst(
          "type",
          typeRef.name,
          typeRef.schema,
          SHELL_TYPE_SIGNATURE,
        ),
      ),
    );
    if (typeRef.schema) {
      requires.push(createObjectRefFromAst("schema", typeRef.schema));
    }
  }

  const definition = Array.isArray(statementNode.definition)
    ? statementNode.definition
    : [];
  for (const optionNode of definition) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }

    const optionName = defElem.defname.toLowerCase();
    if (baseTypeTypeOptionNames.has(optionName)) {
      const optionTypeRef = typeFromTypeNameNode(
        asRecord(defElem.arg)?.TypeName,
      );
      if (optionTypeRef) {
        requires.push(optionTypeRef);
        if (typeRef && isSelfTypeReference(typeRef, optionTypeRef, context)) {
          diagnostics.push(
            selfReferenceDiagnostic(
              optionTypeRef,
              `Base type '${typeRef.schema ? `${typeRef.schema}.` : ""}${typeRef.name}' cannot use itself for option '${optionName}'.`,
            ),
          );
        }
        if (
          optionTypeRef.schema === "pg_catalog" &&
          !isKnownPgCatalogTypeRef(optionTypeRef)
        ) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            message: `No valid pg_catalog base type option type '${optionTypeRef.name}' found for option '${optionName}'.`,
            objectRefs: [optionTypeRef],
            suggestedFix:
              "Use a valid pg_catalog type or create the referenced type explicitly in a user schema.",
          });
        }
      }
      continue;
    }

    if (!baseTypeFunctionOptionNames.has(optionName)) {
      continue;
    }

    const functionTypeName = asRecord(asRecord(defElem.arg)?.TypeName);
    const functionNameParts = extractNameParts(functionTypeName?.names);
    const functionRef = objectFromNameParts("function", functionNameParts);
    if (functionRef) {
      const alternatives = baseTypeFunctionArgAlternatives(optionName, typeRef);
      const returnType = baseTypeFunctionReturnType(optionName, typeRef);
      const callbackRefs: ObjectRef[] = [];
      for (const args of alternatives) {
        const callbackRef = markExactKindRef(
          markExactSignatureRef(
            createObjectRefFromAst(
              "function",
              functionRef.name,
              functionRef.schema,
              typeRefsSignature(args, returnType),
            ),
          ),
        );
        callbackRefs.push(callbackRef);
        if (isBuiltInBaseTypeCallbackName(optionName, functionNameParts)) {
          if (functionNameParts.length === 1) {
            requires.push(markOmitIfNoLocalProducerRef(callbackRef));
          }
          continue;
        }

        requires.push(
          alternatives.length > 1
            ? markAlternativeRef(
                callbackRef,
                `base_type:${typeRef?.schema ?? DEFAULT_SCHEMA}.${typeRef?.name}:${optionName}:${functionRef.schema ?? DEFAULT_SCHEMA}.${functionRef.name}`,
              )
            : callbackRef,
        );
      }
      if (
        callbackRefs.length > 0 &&
        isPgCatalogQualifiedName(functionNameParts) &&
        !isBuiltInBaseTypeCallbackName(optionName, functionNameParts)
      ) {
        diagnostics.push({
          code: "UNRESOLVED_DEPENDENCY",
          message: `No valid pg_catalog base type callback '${functionRef.name}' found for option '${optionName}'.`,
          objectRefs: callbackRefs,
          suggestedFix:
            "Use a valid pg_catalog base type callback or create the referenced callback function explicitly in a user schema.",
        });
      }
    }
  }

  return { provides, requires, diagnostics };
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
          requires.push(createObjectRefFromAst("role", roleName));
        }
      }
    }

    if (defElem.defname === "schemas") {
      const schemaItems = asRecord(asRecord(defElem.arg)?.List)?.items;
      const names = extractNameParts(schemaItems);
      for (const schemaName of names) {
        requires.push(createObjectRefFromAst("schema", schemaName));
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

  return { provides, requires };
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
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
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
      const defineStmt = asRecord(astNode.DefineStmt);
      if (defineStmt?.kind === "OBJECT_TYPE") {
        if (
          Array.isArray(defineStmt.definition) &&
          defineStmt.definition.length > 0
        ) {
          return extractCreateBaseTypeDependencies(defineStmt, context);
        }

        const shellTypeRef = objectFromNameParts(
          "type",
          extractNameParts(defineStmt.defnames),
        );
        return {
          provides: shellTypeRef
            ? [
                createObjectRefFromAst(
                  "type",
                  shellTypeRef.name,
                  shellTypeRef.schema,
                  SHELL_TYPE_SIGNATURE,
                ),
              ]
            : [],
          requires: shellTypeRef?.schema
            ? [createObjectRefFromAst("schema", shellTypeRef.schema)]
            : [],
        };
      }

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
      const rangeStmt = asRecord(astNode.CreateRangeStmt);
      const rangeDependencies = rangeStmt
        ? extractCreateRangeDependencies(rangeStmt, context)
        : null;
      const typeRef = compositeRef ?? enumRef;
      if (rangeDependencies) {
        return rangeDependencies;
      }
      const requires = typeRef?.schema
        ? [createObjectRefFromAst("schema", typeRef.schema)]
        : [];
      if (typeRef) {
        addImplicitArrayCollisionDependency(typeRef, requires, context);
      }
      return {
        provides: typeRef ? typeProviderRefs(typeRef, context) : [],
        requires,
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
      const diagnostics: Diagnostic[] = [];
      if (domainRef) {
        addImplicitArrayCollisionDependency(domainRef, requires, context);
      }
      if (
        domainRef &&
        typeRef &&
        isSelfTypeReference(domainRef, typeRef, context)
      ) {
        diagnostics.push(
          selfReferenceDiagnostic(
            typeRef,
            `Domain '${domainRef.schema ? `${domainRef.schema}.` : ""}${domainRef.name}' cannot use itself as its base type.`,
          ),
        );
      }

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
        provides: domainRef
          ? [domainRef, ...typeProviderRefs(domainRef, context)]
          : [],
        requires,
        diagnostics,
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
          context,
        );
      }
      if (asRecord(astNode.CreateTableAsStmt)) {
        return extractCreateTableAsDependencies(
          asRecord(astNode.CreateTableAsStmt) ?? {},
          "table",
          context,
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

      const requires = relationRef ? [relationRef] : [];
      const accessMethod =
        typeof indexStmt?.accessMethod === "string"
          ? indexStmt.accessMethod
          : "";
      addAccessMethodDependencyIfNeeded(accessMethod, requires, "index");

      return {
        provides: dedupeObjectRefs([
          ...(indexRef ? [indexRef] : []),
          ...uniqueKeyProvides,
        ]),
        requires,
      };
    }
    case "CREATE_OPERATOR":
      return extractCreateOperatorDependencies(
        asRecord(astNode.DefineStmt) ?? {},
        context,
      );
    case "CREATE_OPERATOR_CLASS":
      return extractCreateOperatorClassDependencies(
        asRecord(astNode.CreateOpClassStmt) ?? {},
        context,
      );
    case "CREATE_OPERATOR_FAMILY":
      return extractCreateOperatorFamilyDependencies(
        asRecord(astNode.CreateOpFamilyStmt) ?? {},
      );
    case "CREATE_ACCESS_METHOD":
      return extractCreateAccessMethodDependencies(
        asRecord(astNode.CreateAmStmt) ?? {},
      );
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
      return extractViewDependencies(
        asRecord(astNode.ViewStmt) ?? {},
        "view",
        context,
      );
    case "CREATE_MATERIALIZED_VIEW":
      if (asRecord(astNode.ViewStmt)) {
        return extractViewDependencies(
          asRecord(astNode.ViewStmt) ?? {},
          "materialized_view",
          context,
        );
      }
      if (asRecord(astNode.CreateTableAsStmt)) {
        return extractCreateTableAsDependencies(
          asRecord(astNode.CreateTableAsStmt) ?? {},
          "materialized_view",
          context,
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
  context: ExtractionContext = EMPTY_EXTRACTION_CONTEXT,
): ExtractDependenciesResult => {
  const extracted = extractDependencyRefs(statementClass, ast, context);
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
    diagnostics: extracted.diagnostics,
  };
};
