import {
  classifyStatement,
  phaseForStatementClass,
  statementClassAstNode,
} from "./classify/classify-statement.ts";
import {
  createExtractionContext,
  defaultBtreeOperatorClassProviderRefForSubtype,
  domainBaseTypeRef,
  extractDependencies,
  hasPgCatalogDefaultBtreeOperatorClassForSubtype,
  omittedRangeSubtypeOperatorClassSubtypeRef,
} from "./extract/extract-dependencies.ts";
import { buildGraph, type EdgeMetadata } from "./graph/build-graph.ts";
import { compareStatementIndices, topoSort } from "./graph/topo-sort.ts";
import { type ParsedStatement, parseSqlContent } from "./ingest/parse.ts";
import {
  isKindCompatible,
  operatorClassSignaturesCompatible,
  signaturesCompatible,
} from "./model/object-compat.ts";
import {
  isImplicitProvider,
  objectRefKey,
  requiresExactKind,
  requiresExactSignature,
  shouldOmitIfNoLocalProducer,
} from "./model/object-ref.ts";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  Diagnostic,
  GraphEdge,
  GraphReport,
  ObjectRef,
  StatementNode,
} from "./model/types.ts";
import { splitTopLevel } from "./utils/split-top-level.ts";

const dedupeDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] => {
  const map = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const statementKey = diagnostic.statementId
      ? `${diagnostic.statementId.filePath}:${diagnostic.statementId.statementIndex}`
      : "";
    const objectRefsKey = (diagnostic.objectRefs ?? [])
      .map(
        (objectRef) =>
          `${objectRef.kind}:${objectRef.schema ?? ""}:${objectRef.name}:${objectRef.signature ?? ""}`,
      )
      .join("|");
    const key = `${diagnostic.code}|${statementKey}|${diagnostic.message}|${objectRefsKey}`;
    map.set(key, diagnostic);
  }
  return [...map.values()];
};

const compareDiagnostics = (left: Diagnostic, right: Diagnostic): number => {
  const leftPath = left.statementId?.filePath ?? "";
  const rightPath = right.statementId?.filePath ?? "";
  const pathDelta = leftPath.localeCompare(rightPath);
  if (pathDelta !== 0) {
    return pathDelta;
  }

  const leftIndex = left.statementId?.statementIndex ?? -1;
  const rightIndex = right.statementId?.statementIndex ?? -1;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  const codeDelta = left.code.localeCompare(right.code);
  if (codeDelta !== 0) {
    return codeDelta;
  }

  return left.message.localeCompare(right.message);
};

const addImplicitRangeOperatorClassDependencies = (
  statementNodes: StatementNode[],
  parsedStatements: ParsedStatement[],
  diagnostics: Diagnostic[],
  externalProviders?: AnalyzeOptions["externalProviders"],
): void => {
  const extractionContext = createExtractionContext(
    parsedStatements.map((statement) => statement.ast),
    externalProviders,
  );
  const hasExternalDefaultBtreeOperatorClass = (
    subtypeRef: ObjectRef,
  ): boolean => {
    const subtypeSignature = subtypeRef.schema
      ? `${subtypeRef.schema}.${subtypeRef.name}`
      : subtypeRef.name;
    return (
      externalProviders?.some(
        (providerRef) =>
          providerRef.kind === "operator_class" &&
          providerRef.implicitProvider === true &&
          operatorClassSignaturesCompatible(
            `(btree,${subtypeSignature})`,
            providerRef.signature,
          ),
      ) === true
    );
  };
  const externalSubtypeSignatureHasDefaultBtreeOperatorClass = (
    signature?: string,
  ): boolean => {
    const normalizedSignature = signature?.trim().toLowerCase();
    return (
      normalizedSignature === "(enum)" ||
      normalizedSignature === "(range)" ||
      normalizedSignature === "(multirange)"
    );
  };
  const hasExternalSubtypeDefaultBtreeOperatorClass = (
    subtypeRef: ObjectRef,
  ): boolean =>
    externalProviders?.some((providerRef) => {
      if (providerRef.kind !== "type") {
        return false;
      }
      if (subtypeRef.schema && providerRef.schema !== subtypeRef.schema) {
        return false;
      }
      if (
        providerRef.name === subtypeRef.name &&
        externalSubtypeSignatureHasDefaultBtreeOperatorClass(
          providerRef.signature,
        )
      ) {
        return true;
      }

      return false;
    }) === true;

  const subtypeOperatorClassSignature = (subtypeRef: ObjectRef): string => {
    const subtypeSignature = subtypeRef.schema
      ? `${subtypeRef.schema}.${subtypeRef.name}`
      : subtypeRef.name;
    return `(btree,${subtypeSignature})`;
  };

  const defaultBtreeOperatorClassProvidedRefForSubtype = (
    providerRef: ObjectRef,
    subtypeRef: ObjectRef,
  ): ObjectRef | null => {
    if (providerRef.kind !== "operator_class") {
      return null;
    }
    if (
      operatorClassSignaturesCompatible(
        subtypeOperatorClassSignature(subtypeRef),
        providerRef.signature,
      )
    ) {
      return providerRef;
    }
    return null;
  };

  for (let index = 0; index < statementNodes.length; index += 1) {
    const statementNode = statementNodes[index];
    const parsedStatement = parsedStatements[index];
    if (
      !statementNode ||
      statementNode.statementClass !== "CREATE_TYPE" ||
      !parsedStatement
    ) {
      continue;
    }

    const subtypeRef = omittedRangeSubtypeOperatorClassSubtypeRef(
      parsedStatement.ast,
    );
    if (!subtypeRef) {
      continue;
    }
    const effectiveSubtypeRef =
      domainBaseTypeRef(subtypeRef, extractionContext) ?? subtypeRef;

    const rangeOperatorClassRefs = new Map<
      string,
      ReturnType<typeof defaultBtreeOperatorClassProviderRefForSubtype>
    >();
    for (const providerStatement of parsedStatements) {
      const providerRef = defaultBtreeOperatorClassProviderRefForSubtype(
        providerStatement.ast,
        effectiveSubtypeRef,
      );
      if (providerRef) {
        rangeOperatorClassRefs.set(objectRefKey(providerRef), providerRef);
      }
    }
    for (const providerNode of statementNodes) {
      for (const providedRef of providerNode.annotations.provides) {
        const providerRef = defaultBtreeOperatorClassProvidedRefForSubtype(
          providedRef,
          effectiveSubtypeRef,
        );
        if (providerRef) {
          rangeOperatorClassRefs.set(objectRefKey(providerRef), providerRef);
        }
      }
    }

    for (const providerRef of rangeOperatorClassRefs.values()) {
      if (providerRef) {
        statementNode.requires.push(providerRef);
      }
    }

    if (
      rangeOperatorClassRefs.size === 0 &&
      !hasExternalDefaultBtreeOperatorClass(effectiveSubtypeRef) &&
      !hasExternalSubtypeDefaultBtreeOperatorClass(effectiveSubtypeRef) &&
      !hasPgCatalogDefaultBtreeOperatorClassForSubtype(
        subtypeRef,
        extractionContext,
      )
    ) {
      const subtypeName = subtypeRef.schema
        ? `${subtypeRef.schema}.${subtypeRef.name}`
        : subtypeRef.name;
      diagnostics.push({
        code: "UNRESOLVED_DEPENDENCY",
        message: `No default btree operator class provider found for range subtype '${subtypeName}'.`,
        statementId: statementNode.id,
        objectRefs: [subtypeRef],
        suggestedFix:
          "Add a default btree operator class for the range subtype or specify SUBTYPE_OPCLASS explicitly.",
        details: {
          rangeSubtype: subtypeName,
        },
      });
    }
  }
};

const argsOnlySignature = (signature?: string): string | null => {
  const trimmed = signature?.trim();
  if (!trimmed?.startsWith("(")) {
    return null;
  }
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(0, index + 1);
      }
    }
  }
  return null;
};

const hasReturnSignature = (signature?: string): boolean =>
  signature?.includes("->") === true;

const omitRequirementsWithoutLocalProducers = (
  statementNodes: StatementNode[],
  externalProviders: AnalyzeOptions["externalProviders"] = [],
): void => {
  const providerRefs: ObjectRef[] = [];
  for (const statementNode of statementNodes) {
    providerRefs.push(...statementNode.provides);
  }
  providerRefs.push(...externalProviders);

  const providerKeys = new Set(
    providerRefs.map((providedRef) => objectRefKey(providedRef)),
  );

  const operatorClassAccessMethod = (
    signature?: string,
  ): string | undefined => {
    if (!signature?.startsWith("(") || !signature.endsWith(")")) {
      return undefined;
    }

    const accessMethod = splitTopLevel(signature.slice(1, -1), ",")
      .at(0)
      ?.trim()
      .toLowerCase();
    return accessMethod && accessMethod.length > 0 ? accessMethod : undefined;
  };

  const hasProducerOperatorClassShadow = (requiredRef: ObjectRef): boolean => {
    if (requiredRef.kind !== "operator_class") {
      return false;
    }

    const requiredAccessMethod = operatorClassAccessMethod(
      requiredRef.signature,
    );
    if (!requiredAccessMethod) {
      return false;
    }

    for (const providedRef of providerRefs) {
      if (providedRef.kind !== "operator_class") {
        continue;
      }
      if (providedRef.name !== requiredRef.name) {
        continue;
      }
      if (requiredRef.schema && providedRef.schema !== requiredRef.schema) {
        continue;
      }
      if (
        operatorClassAccessMethod(providedRef.signature) !==
        requiredAccessMethod
      ) {
        continue;
      }
      return true;
    }

    return false;
  };

  const hasProducer = (
    requiredRef: NonNullable<StatementNode["requires"][number]>,
  ): boolean => {
    const requiredKey = objectRefKey(requiredRef);
    if (providerKeys.has(requiredKey)) {
      return true;
    }

    if (hasProducerOperatorClassShadow(requiredRef)) {
      return true;
    }

    const requiredArgsOnlySignature = argsOnlySignature(requiredRef.signature);

    for (const providedRef of providerRefs) {
      if (
        requiresExactKind(requiredRef) &&
        providedRef.kind !== requiredRef.kind
      ) {
        continue;
      }
      if (!isKindCompatible(requiredRef.kind, providedRef.kind)) {
        continue;
      }
      if (providedRef.name !== requiredRef.name) {
        continue;
      }
      if (requiredRef.schema && providedRef.schema !== requiredRef.schema) {
        continue;
      }
      if (requiredArgsOnlySignature) {
        const providedArgsOnlySignature = argsOnlySignature(
          providedRef.signature,
        );
        if (
          (!hasReturnSignature(requiredRef.signature) ||
            hasReturnSignature(providedRef.signature)) &&
          providedArgsOnlySignature &&
          signaturesCompatible(
            requiredArgsOnlySignature,
            providedArgsOnlySignature,
            {
              rejectPolymorphicProviderArgs:
                requiresExactSignature(requiredRef),
              requireExactArity: requiresExactSignature(requiredRef),
            },
          )
        ) {
          return true;
        }
      }
      const requireExactSignature = requiresExactSignature(requiredRef);
      const signaturesMatch =
        requiredRef.kind === "operator_class" &&
        providedRef.kind === "operator_class"
          ? operatorClassSignaturesCompatible(
              requiredRef.signature,
              providedRef.signature,
            )
          : signaturesCompatible(requiredRef.signature, providedRef.signature, {
              rejectPolymorphicProviderArgs: requireExactSignature,
              requireExactArity: requireExactSignature,
            });
      if (!signaturesMatch) {
        continue;
      }
      return true;
    }

    return false;
  };

  for (const statementNode of statementNodes) {
    statementNode.requires = statementNode.requires.filter(
      (requiredRef) =>
        !shouldOmitIfNoLocalProducer(requiredRef) || hasProducer(requiredRef),
    );
  }
};

const resolveExplicitOperatorFamilyProviders = (
  statementNodes: StatementNode[],
): void => {
  const explicitProviderKeys = new Set<string>();
  for (const statementNode of statementNodes) {
    for (const providedRef of statementNode.provides) {
      if (!isImplicitProvider(providedRef)) {
        explicitProviderKeys.add(objectRefKey(providedRef));
      }
    }
  }

  for (const statementNode of statementNodes) {
    const removedImplicitProviders = statementNode.provides.filter(
      (providedRef) =>
        isImplicitProvider(providedRef) &&
        explicitProviderKeys.has(objectRefKey(providedRef)),
    );
    if (removedImplicitProviders.length === 0) {
      continue;
    }

    const removedKeys = new Set(removedImplicitProviders.map(objectRefKey));
    statementNode.provides = statementNode.provides.filter(
      (providedRef) => !removedKeys.has(objectRefKey(providedRef)),
    );

    for (const removedProvider of removedImplicitProviders) {
      if (
        !statementNode.requires.some(
          (requiredRef) =>
            objectRefKey(requiredRef) === objectRefKey(removedProvider),
        )
      ) {
        statementNode.requires.push(removedProvider);
      }
    }
  }
};

const buildGraphReport = (
  nodes: StatementNode[],
  edges: Map<number, Set<number>>,
  edgeMetadata: Map<string, EdgeMetadata>,
  cycleGroups: number[][],
): GraphReport => {
  const sortedFromIndices = [...edges.keys()].sort((left, right) =>
    compareStatementIndices(left, right, nodes),
  );
  const graphEdges: GraphEdge[] = [];

  for (const fromIndex of sortedFromIndices) {
    const toIndices = [...(edges.get(fromIndex) ?? new Set<number>())].sort(
      (left, right) => compareStatementIndices(left, right, nodes),
    );
    for (const toIndex of toIndices) {
      const fromNode = nodes[fromIndex];
      const toNode = nodes[toIndex];
      if (!fromNode || !toNode) {
        continue;
      }
      const metadata = edgeMetadata.get(`${fromIndex}->${toIndex}`);
      if (!metadata) {
        continue;
      }
      graphEdges.push({
        from: fromNode.id,
        to: toNode.id,
        reason: metadata.reason,
        objectRef: metadata.objectRef,
      });
    }
  }

  return {
    nodeCount: nodes.length,
    edges: graphEdges,
    cycleGroups: cycleGroups.map((cycleGroup) =>
      cycleGroup
        .map((index) => nodes[index]?.id)
        .filter((statementId): statementId is StatementNode["id"] =>
          Boolean(statementId),
        ),
    ),
  };
};

const EMPTY_RESULT: AnalyzeResult = {
  ordered: [],
  diagnostics: [],
  graph: {
    nodeCount: 0,
    edges: [],
    cycleGroups: [],
  },
};

export const analyzeAndSort = async (
  sql: string[],
  options?: AnalyzeOptions,
): Promise<AnalyzeResult> => {
  if (sql.length === 0) {
    return {
      ...EMPTY_RESULT,
      diagnostics: [
        {
          code: "DISCOVERY_ERROR",
          message: "No SQL input provided.",
        },
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const parsedStatements: ParsedStatement[] = [];

  for (let i = 0; i < sql.length; i += 1) {
    const parsed = await parseSqlContent(sql[i], `<input:${i}>`);
    parsedStatements.push(...parsed.statements);
    diagnostics.push(...parsed.diagnostics);
  }

  const statementNodes: StatementNode[] = [];
  const extractionContext = createExtractionContext(
    parsedStatements.map((statement) => statement.ast),
    options?.externalProviders,
  );
  for (const parsedStatement of parsedStatements) {
    const statementClass = classifyStatement(parsedStatement.ast);
    if (statementClass === "UNKNOWN") {
      diagnostics.push({
        code: "UNKNOWN_STATEMENT_CLASS",
        message: `Unsupported statement AST root '${statementClassAstNode(parsedStatement.ast) ?? "unknown"}'.`,
        statementId: parsedStatement.id,
      });
    }

    const extraction = extractDependencies(
      statementClass,
      parsedStatement.ast,
      parsedStatement.annotations,
      extractionContext,
    );
    for (const diagnostic of extraction.diagnostics ?? []) {
      diagnostics.push({
        ...diagnostic,
        statementId: diagnostic.statementId ?? parsedStatement.id,
      });
    }

    statementNodes.push({
      id: parsedStatement.id,
      sql: parsedStatement.sql,
      statementClass,
      provides: extraction.provides,
      requires: extraction.requires,
      phase:
        parsedStatement.annotations.phase ??
        phaseForStatementClass(statementClass),
      annotations: parsedStatement.annotations,
    });
  }

  addImplicitRangeOperatorClassDependencies(
    statementNodes,
    parsedStatements,
    diagnostics,
    options?.externalProviders,
  );
  resolveExplicitOperatorFamilyProviders(statementNodes);
  omitRequirementsWithoutLocalProducers(
    statementNodes,
    options?.externalProviders,
  );

  const graphState = buildGraph(statementNodes, options?.externalProviders);
  diagnostics.push(...graphState.diagnostics);

  const topoResult = topoSort(statementNodes, graphState.edges);
  if (topoResult.cycleGroups.length > 0) {
    for (const cycleGroup of topoResult.cycleGroups) {
      const firstCycleIndex = cycleGroup[0];
      const firstCycleNode =
        typeof firstCycleIndex === "number"
          ? statementNodes[firstCycleIndex]
          : undefined;
      const cycleSet = new Set(cycleGroup);
      const cycleStatements = cycleGroup
        .map((index) => statementNodes[index]?.id)
        .filter((statementId): statementId is StatementNode["id"] =>
          Boolean(statementId),
        )
        .map(
          (statementId) =>
            `${statementId.filePath}:${statementId.statementIndex}${statementId.sourceOffset != null ? `@${statementId.sourceOffset}` : ""}`,
        );
      const cycleObjectKeys = [...graphState.edgeMetadata.entries()]
        .filter(([edge]) => {
          const [fromText, toText] = edge.split("->");
          if (!fromText || !toText) {
            return false;
          }
          const fromIndex = Number.parseInt(fromText, 10);
          const toIndex = Number.parseInt(toText, 10);
          return cycleSet.has(fromIndex) && cycleSet.has(toIndex);
        })
        .map(([, metadata]) => metadata.objectRef)
        .filter((objectRef): objectRef is NonNullable<typeof objectRef> =>
          Boolean(objectRef),
        )
        .map((objectRef) => objectRefKey(objectRef))
        .sort((left, right) => left.localeCompare(right));

      diagnostics.push({
        code: "CYCLE_DETECTED",
        message: `Dependency cycle detected across ${cycleGroup.length} statements.`,
        statementId: firstCycleNode?.id,
        details: {
          cycleStatements,
          cycleObjectKeys,
        },
        suggestedFix:
          "Break the cycle by splitting DDL into separate statements or adding explicit pg-topo:depends_on annotations.",
      });
    }
  }

  // `orderedIndices` is a total order of every successfully parsed statement.
  const ordered = topoResult.orderedIndices
    .map((index) => statementNodes[index])
    .filter((statementNode): statementNode is StatementNode =>
      Boolean(statementNode),
    );
  const graph = buildGraphReport(
    statementNodes,
    graphState.edges,
    graphState.edgeMetadata,
    topoResult.cycleGroups,
  );

  const sortedDiagnostics =
    dedupeDiagnostics(diagnostics).sort(compareDiagnostics);
  return {
    ordered,
    diagnostics: sortedDiagnostics,
    graph,
  };
};
