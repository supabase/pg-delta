import {
  classifyStatement,
  phaseForStatementClass,
  statementClassAstNode,
} from "./classify/classify-statement.ts";
import { extractDependencies } from "./extract/extract-dependencies.ts";
import { buildGraph, type EdgeMetadata } from "./graph/build-graph.ts";
import { compareStatementIndices, topoSort } from "./graph/topo-sort.ts";
import { type ParsedStatement, parseSqlContent } from "./ingest/parse.ts";
import { objectRefKey } from "./model/object-ref.ts";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  Diagnostic,
  GraphEdge,
  GraphReport,
  StatementNode,
} from "./model/types.ts";

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
    );

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

  // `ordered` must be a total order — a complete permutation of the input.
  // Kahn's algorithm drains only the acyclic prefix, so statements trapped in
  // a dependency cycle are absent from `orderedIndices` (they still surface in
  // `cycleGroups` and the CYCLE_DETECTED diagnostic). Append those statements
  // after the drained prefix using the same deterministic tie-break order.
  const drainedIndices = new Set(topoResult.orderedIndices);
  const cycleTailIndices = statementNodes
    .map((_statementNode, index) => index)
    .filter((index) => !drainedIndices.has(index))
    .sort((left, right) =>
      compareStatementIndices(left, right, statementNodes),
    );
  const ordered = [...topoResult.orderedIndices, ...cycleTailIndices]
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
