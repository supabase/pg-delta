import {
  isKindCompatible,
  signaturesCompatible,
} from "../model/object-compat.ts";
import { isBuiltInObjectRef, objectRefKey } from "../model/object-ref.ts";
import type {
  Diagnostic,
  GraphEdgeReason,
  ObjectRef,
  StatementNode,
} from "../model/types.ts";

export type EdgeMetadata = {
  reason: GraphEdgeReason;
  objectRef?: ObjectRef;
};

export type GraphState = {
  edges: Map<number, Set<number>>;
  edgeMetadata: Map<string, EdgeMetadata>;
  producersByKey: Map<string, number[]>;
  diagnostics: Diagnostic[];
};

const edgeKey = (fromIndex: number, toIndex: number): string =>
  `${fromIndex}->${toIndex}`;

const addEdge = (
  graphState: GraphState,
  fromIndex: number,
  toIndex: number,
  metadata: EdgeMetadata,
): void => {
  const adjacency = graphState.edges.get(fromIndex) ?? new Set<number>();
  adjacency.add(toIndex);
  graphState.edges.set(fromIndex, adjacency);
  graphState.edgeMetadata.set(edgeKey(fromIndex, toIndex), metadata);
};

// BFS reachability check: returns true if there is already a directed path
// from `source` to `target` through existing edges. Used to avoid adding an
// edge that would introduce a cycle.
const hasPathTo = (
  edges: Map<number, Set<number>>,
  source: number,
  target: number,
): boolean => {
  const visited = new Set<number>();
  const queue = [source];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    if (current === target) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const neighbor of edges.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }
  return false;
};

const sqlExcerpt = (sql: string, maxLength = 80): string => {
  const firstLine = sql.split("\n")[0] ?? sql;
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength)}...`
    : firstLine;
};

const statementLabel = (node: StatementNode): string =>
  `${node.id.filePath}:${node.id.statementIndex}${node.id.sourceOffset != null ? `@${node.id.sourceOffset}` : ""} (${sqlExcerpt(node.sql)})`;

const externalProviderSatisfies = (
  requiredRef: ObjectRef,
  externalByName: Map<string, ObjectRef[]>,
): boolean => {
  const candidates = externalByName.get(requiredRef.name.toLowerCase());
  if (!candidates?.length) {
    return false;
  }
  for (const provider of candidates) {
    if (!isKindCompatible(requiredRef.kind, provider.kind)) {
      continue;
    }
    if (
      requiredRef.schema != null &&
      requiredRef.schema !== "" &&
      provider.schema !== requiredRef.schema
    ) {
      continue;
    }
    if (
      !signaturesCompatible(requiredRef.signature, provider.signature, {
        allowVariadicProviderTail: true,
      })
    ) {
      continue;
    }
    return true;
  }
  return false;
};

const candidateObjectKeysForRequirement = (
  requiredRef: ObjectRef,
  nodes: StatementNode[],
  mode: "compatible" | "similar_name",
): string[] => {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    for (const providedRef of node.provides) {
      if (!isKindCompatible(requiredRef.kind, providedRef.kind)) {
        continue;
      }
      if (providedRef.name !== requiredRef.name) {
        continue;
      }
      if (
        mode === "compatible" &&
        requiredRef.schema &&
        providedRef.schema !== requiredRef.schema
      ) {
        continue;
      }
      keys.add(objectRefKey(providedRef));
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
};

const producerIndicesForRequirement = (
  requiredRef: ObjectRef,
  nodes: StatementNode[],
): number[] => {
  const indices: number[] = [];
  for (
    let producerIndex = 0;
    producerIndex < nodes.length;
    producerIndex += 1
  ) {
    const node = nodes[producerIndex];
    if (!node) {
      continue;
    }

    const hasMatchingProvide = node.provides.some((providedRef) => {
      if (!isKindCompatible(requiredRef.kind, providedRef.kind)) {
        return false;
      }
      if (providedRef.name !== requiredRef.name) {
        return false;
      }
      if (requiredRef.schema && providedRef.schema !== requiredRef.schema) {
        return false;
      }
      if (!signaturesCompatible(requiredRef.signature, providedRef.signature)) {
        return false;
      }
      return true;
    });

    if (hasMatchingProvide) {
      indices.push(producerIndex);
    }
  }
  return indices;
};

export const buildGraph = (
  nodes: StatementNode[],
  externalProviders?: ObjectRef[],
): GraphState => {
  const diagnostics: Diagnostic[] = [];
  const producersByKey = new Map<string, number[]>();
  const edges = new Map<number, Set<number>>();
  const edgeMetadata = new Map<string, EdgeMetadata>();
  const graphState: GraphState = {
    edges,
    edgeMetadata,
    producersByKey,
    diagnostics,
  };

  const externalByName = new Map<string, ObjectRef[]>();
  if (externalProviders) {
    for (const ref of externalProviders) {
      const key = ref.name.toLowerCase();
      const list = externalByName.get(key) ?? [];
      list.push(ref);
      externalByName.set(key, list);
    }
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    for (const providedRef of node.provides) {
      const key = objectRefKey(providedRef);
      const producerIndices = producersByKey.get(key) ?? [];
      producerIndices.push(index);
      producersByKey.set(key, producerIndices);
    }
  }

  for (const [producerKey, producerIndices] of producersByKey.entries()) {
    if (producerIndices.length < 2) {
      continue;
    }
    const firstProducerIndex = producerIndices[0];
    const firstProducer =
      typeof firstProducerIndex === "number"
        ? nodes[firstProducerIndex]
        : undefined;
    const sampleRef = firstProducer?.provides.find(
      (providedRef: ObjectRef) => objectRefKey(providedRef) === producerKey,
    );
    for (const duplicateIndex of producerIndices) {
      const duplicateNode = nodes[duplicateIndex];
      if (!duplicateNode) {
        continue;
      }
      diagnostics.push({
        code: "DUPLICATE_PRODUCER",
        message: `Multiple statements provide '${producerKey}'. This statement: ${sqlExcerpt(duplicateNode.sql)}`,
        objectRefs: sampleRef ? [sampleRef] : undefined,
        statementId: duplicateNode.id,
      });
    }
  }

  for (
    let consumerIndex = 0;
    consumerIndex < nodes.length;
    consumerIndex += 1
  ) {
    const consumer = nodes[consumerIndex];
    if (!consumer) {
      continue;
    }
    for (const requiredRef of consumer.requires) {
      if (isBuiltInObjectRef(requiredRef)) {
        continue;
      }

      const requiredKey = objectRefKey(requiredRef);
      const producerIndices = producersByKey.get(requiredKey) ?? [];

      if (producerIndices.length === 1) {
        const producerIndex = producerIndices[0];
        if (
          typeof producerIndex === "number" &&
          producerIndex !== consumerIndex
        ) {
          addEdge(graphState, producerIndex, consumerIndex, {
            reason: "requires",
            objectRef: requiredRef,
          });
        }
        continue;
      }

      if (producerIndices.length > 1) {
        if (requiredRef.kind === "constraint") {
          const uniqueProducerIndices = [...new Set(producerIndices)].filter(
            (producerIndex) => producerIndex !== consumerIndex,
          );
          for (const producerIndex of uniqueProducerIndices) {
            addEdge(graphState, producerIndex, consumerIndex, {
              reason: "requires_constraint_key",
              objectRef: requiredRef,
            });
          }
          continue;
        }

        const candidateObjectKeys = candidateObjectKeysForRequirement(
          requiredRef,
          nodes,
          "compatible",
        );
        diagnostics.push({
          code: "DUPLICATE_PRODUCER",
          message: `Ambiguous dependency '${requiredKey}' has multiple producers.`,
          statementId: consumer.id,
          objectRefs: [requiredRef],
          suggestedFix:
            "Use pg-topo:requires with an explicit signature or schema-qualified object to disambiguate.",
          details: {
            requiredObjectKey: requiredKey,
            candidateObjectKeys,
          },
        });
        continue;
      }

      const compatibleProducerIndices = producerIndicesForRequirement(
        requiredRef,
        nodes,
      ).filter((index) => index !== consumerIndex);
      if (compatibleProducerIndices.length === 1) {
        const producerIndex = compatibleProducerIndices[0];
        if (typeof producerIndex !== "number") {
          continue;
        }
        addEdge(graphState, producerIndex, consumerIndex, {
          reason: "requires_compatible",
          objectRef: requiredRef,
        });
        continue;
      }

      // When prefix-based signature matching (for default params) finds multiple
      // compatible overloads, create edges to ALL of them. For topological
      // ordering this is correct: the consumer must come after every potential
      // provider. A missing edge would cause runtime failures; an extra edge
      // only adds a (harmless) ordering constraint.
      //
      // However, since prefix matching is more lenient than exact matching, a
      // false-positive match could introduce a cycle. A cycle is strictly worse
      // than a missing edge because it can obscure the intended dependency
      // order. So we check reachability before adding each edge: if the consumer
      // already has a path to the candidate producer, adding the reverse edge
      // would create a cycle and we skip it, emitting a diagnostic that suggests
      // an explicit annotation to resolve the ambiguity.
      if (compatibleProducerIndices.length > 1) {
        for (const producerIndex of compatibleProducerIndices) {
          if (typeof producerIndex !== "number") {
            continue;
          }
          if (hasPathTo(graphState.edges, consumerIndex, producerIndex)) {
            const producerNode = nodes[producerIndex];
            const producerLabel = producerNode
              ? statementLabel(producerNode)
              : `<unknown statement ${producerIndex}>`;
            const consumerLabel = statementLabel(consumer);
            const refKey = objectRefKey(requiredRef);
            const producerSignatures = (producerNode?.provides ?? [])
              .map(objectRefKey)
              .join(", ");
            diagnostics.push({
              code: "CYCLE_EDGE_SKIPPED",
              message:
                `Skipped dependency on '${refKey}' ` +
                `from producer ${producerLabel} ` +
                `to consumer ${consumerLabel}: ` +
                `adding this edge would create a cycle because the consumer already depends on the producer.`,
              statementId: consumer.id,
              objectRefs: [requiredRef],
              suggestedFix: `Add an explicit annotation to the consumer, e.g.: -- pg-topo:requires ${refKey.replace(":(unknown", ":(exact_type")}`,
              details: {
                producerStatementId: producerNode?.id,
                producerProvides: producerSignatures,
                consumerRequires: refKey,
              },
            });
            continue;
          }
          addEdge(graphState, producerIndex, consumerIndex, {
            reason: "requires_compatible",
            objectRef: requiredRef,
          });
        }
        continue;
      }

      if (externalProviderSatisfies(requiredRef, externalByName)) {
        continue;
      }

      const candidateObjectKeys = candidateObjectKeysForRequirement(
        requiredRef,
        nodes,
        "similar_name",
      );
      const suggestedFix =
        candidateObjectKeys.length > 0
          ? "A similarly named object exists in a different schema or signature; qualify it explicitly or add a pg-topo:requires annotation."
          : "Add the missing statement to your SQL set or declare an explicit pg-topo annotation.";

      diagnostics.push({
        code: "UNRESOLVED_DEPENDENCY",
        message: `No producer found for '${requiredKey}'.`,
        statementId: consumer.id,
        objectRefs: [requiredRef],
        suggestedFix,
        details: {
          requiredObjectKey: requiredKey,
          candidateObjectKeys,
        },
      });
    }
  }

  return graphState;
};
