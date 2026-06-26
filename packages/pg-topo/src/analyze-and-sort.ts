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
import { breakForeignKeyCycles } from "./rewrite/break-fk-cycles.ts";

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

/**
 * Classify and extract dependencies for a parsed statement, producing a
 * StatementNode plus any classification diagnostics. Factored out so the
 * pipeline can rebuild nodes after FK-cycle rewriting without duplicating
 * the logic.
 */
const buildStatementNode = (
  statement: ParsedStatement,
): { node: StatementNode; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const statementClass = classifyStatement(statement.ast);
  if (statementClass === "UNKNOWN") {
    diagnostics.push({
      code: "UNKNOWN_STATEMENT_CLASS",
      message: `Unsupported statement AST root '${statementClassAstNode(statement.ast) ?? "unknown"}'.`,
      statementId: statement.id,
    });
  }

  const extraction = extractDependencies(
    statementClass,
    statement.ast,
    statement.annotations,
  );

  return {
    node: {
      id: statement.id,
      sql: statement.sql,
      statementClass,
      provides: extraction.provides,
      requires: extraction.requires,
      phase:
        statement.annotations.phase ?? phaseForStatementClass(statementClass),
      annotations: statement.annotations,
    },
    diagnostics,
  };
};

const buildStatementNodes = (
  statements: readonly ParsedStatement[],
): { nodes: StatementNode[]; diagnostics: Diagnostic[] } => {
  const nodes: StatementNode[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const statement of statements) {
    const built = buildStatementNode(statement);
    nodes.push(built.node);
    diagnostics.push(...built.diagnostics);
  }
  return { nodes, diagnostics };
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

  const parseDiagnostics: Diagnostic[] = [];
  let workingStatements: ParsedStatement[] = [];

  for (let i = 0; i < sql.length; i += 1) {
    const parsed = await parseSqlContent(sql[i], `<input:${i}>`);
    workingStatements.push(...parsed.statements);
    parseDiagnostics.push(...parsed.diagnostics);
  }

  let built = buildStatementNodes(workingStatements);
  let statementNodes = built.nodes;
  let graphState = buildGraph(statementNodes, options?.externalProviders);
  let topoResult = topoSort(statementNodes, graphState.edges);

  // Break inline foreign-key cycles (pg_dump style) by deferring the
  // cross-cycle FK into a standalone ALTER TABLE ... ADD CONSTRAINT. Only
  // runs when a cycle is actually present, and re-derives the graph from the
  // rewritten statement set so downstream consumers see an acyclic order.
  if (topoResult.cycleGroups.length > 0) {
    const rewritten = await breakForeignKeyCycles(
      workingStatements,
      statementNodes,
      topoResult.cycleGroups,
    );
    if (rewritten) {
      workingStatements = rewritten;
      built = buildStatementNodes(workingStatements);
      statementNodes = built.nodes;
      graphState = buildGraph(statementNodes, options?.externalProviders);
      topoResult = topoSort(statementNodes, graphState.edges);
    }
  }

  const diagnostics: Diagnostic[] = [
    ...parseDiagnostics,
    ...built.diagnostics,
    ...graphState.diagnostics,
  ];

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

  // A statement must never be silently dropped from the result. Kahn's
  // algorithm omits any node left in a cycle (and everything downstream of
  // one), so append those trailing nodes in a deterministic order after the
  // acyclic prefix. The CYCLE_DETECTED diagnostic above still flags the
  // unresolved cycle; consumers (e.g. the declarative apply engine) then see
  // every statement and can surface a real error instead of building an
  // incomplete schema from a truncated list.
  const orderedIndexSet = new Set(topoResult.orderedIndices);
  const trailingIndices: number[] = [];
  for (let index = 0; index < statementNodes.length; index += 1) {
    if (!orderedIndexSet.has(index)) {
      trailingIndices.push(index);
    }
  }
  trailingIndices.sort((left, right) =>
    compareStatementIndices(left, right, statementNodes),
  );

  const ordered = [...topoResult.orderedIndices, ...trailingIndices]
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
