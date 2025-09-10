import { CycleError, Graph, topologicalSort } from "graph-data-structure";
import { Err, Ok, type Result } from "neverthrow";
import { DEBUG } from "../tests/constants.ts";
import { type Catalog, emptyCatalog } from "./catalog.model.js";
import {
  AlterChange,
  type Change,
  CreateChange,
  DropChange,
  ReplaceChange,
} from "./objects/base.change.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
} from "./objects/sequence/changes/sequence.alter.ts";
import { CreateSequence } from "./objects/sequence/changes/sequence.create.ts";
import { DropSequence } from "./objects/sequence/changes/sequence.drop.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { UnexpectedError } from "./objects/utils.js";

type ConstraintType = "before";

interface Constraint {
  constraintStableId: string;
  changeAIndex: number;
  type: ConstraintType;
  changeBIndex: number;
  reason?: string;
}

interface ObjectDependency {
  dependent: string;
  referenced: string;
  source?: "master" | "branch" | string;
}

export class DependencyModel {
  private readonly dependencies = new Map<string, ObjectDependency>();
  private readonly dependencyIndex = new Map<string, Set<string>>();
  private readonly reverseIndex = new Map<string, Set<string>>();

  private getDependencyId(dep: ObjectDependency): string {
    return `${dep.dependent} -> ${dep.referenced} (${dep.source})`;
  }

  addDependency(dependent: string, referenced: string, source = ""): void {
    const dep: ObjectDependency = {
      dependent,
      referenced,
      source,
    };

    if (this.dependencies.has(this.getDependencyId(dep)) === false) {
      this.dependencies.set(this.getDependencyId(dep), dep);
      this.dependencyIndex.set(dependent, new Set());
      this.reverseIndex.set(referenced, new Set());
    }
  }

  hasDependency(
    dependentStableId: string,
    referencedStableId: string,
    sourceFilter: string | null = null,
  ): boolean {
    const depStableId = this.getDependencyId({
      dependent: dependentStableId,
      referenced: referencedStableId,
      source: sourceFilter === null ? undefined : sourceFilter,
    });
    if (this.dependencies.has(depStableId)) {
      return true;
    }
    return false;
  }
}

export class DependencyExtractor {
  private readonly masterCatalog: Catalog;
  private readonly branchCatalog: Catalog;

  constructor(masterCatalog: Catalog, branchCatalog: Catalog) {
    this.masterCatalog = masterCatalog;
    this.branchCatalog = branchCatalog;
  }

  extractForChangeset(changes: Change[]): DependencyModel {
    const relevant = this.findRelevantObjects(changes);
    if (DEBUG) {
      console.log("relevant", relevant);
    }
    const model = new DependencyModel();
    this.extractFromCatalog(model, this.masterCatalog, relevant, "master");
    this.extractFromCatalog(model, this.branchCatalog, relevant, "branch");
    return model;
  }

  private findRelevantObjects(
    changes: Change[],
    // TODO: ask Oli about why we want to dig deeper than level 0 in the dependencies
    maxDepth: number = 2,
  ): Set<string> {
    const relevant = new Set<string>(changes.map((change) => change.stableId));
    // Add transitive dependencies up to max_depth
    for (let i = 0; i < maxDepth; i++) {
      const newObjects = new Set<string>();
      for (const objId of relevant) {
        // Add dependencies from both catalogs
        newObjects.union(this.getDirectDependencies(objId, this.masterCatalog));
        newObjects.union(this.getDirectDependencies(objId, this.branchCatalog));
        // Add dependents from both catalogs
        newObjects.union(this.getDirectDependents(objId, this.masterCatalog));
        newObjects.union(this.getDirectDependents(objId, this.branchCatalog));
      }
      relevant.union(newObjects);
    }
    return relevant;
  }

  private getDirectDependencies(objId: string, catalog: Catalog) {
    const dependencies = new Set<string>();
    for (const depend of catalog.depends) {
      if (
        depend.dependent_stable_id === objId &&
        !depend.referenced_stable_id.startsWith("unknown.")
      ) {
        dependencies.add(depend.referenced_stable_id);
      }
    }
    return dependencies;
  }

  private getDirectDependents(objId: string, catalog: Catalog) {
    const dependents = new Set<string>();
    for (const depend of catalog.depends) {
      if (
        depend.referenced_stable_id === objId &&
        !depend.dependent_stable_id.startsWith("unknown.")
      ) {
        dependents.add(depend.dependent_stable_id);
      }
    }
    return dependents;
  }

  private extractFromCatalog(
    model: DependencyModel,
    catalog: Catalog,
    relevantObjects: Set<string>,
    source: string,
  ): DependencyModel {
    for (const depend of catalog.depends) {
      // Direct dependency between relevant objects
      if (
        relevantObjects.has(depend.dependent_stable_id) &&
        relevantObjects.has(depend.referenced_stable_id) &&
        !depend.dependent_stable_id.startsWith("unknown.") &&
        !depend.referenced_stable_id.startsWith("unknown.")
      ) {
        model.addDependency(
          depend.dependent_stable_id,
          depend.referenced_stable_id,
          source,
        );
      }
    }
    return model;
  }
}

export class OperationSemantics {
  generateConstraints(changes: Change[], model: DependencyModel): Constraint[] {
    const constraints: Constraint[] = [];

    // Add dependency-based constraints
    constraints.push(...this.generateDependencyConstraints(changes, model));

    // Add same-object operation constraints
    constraints.push(...this.generateSameObjectConstraints(changes));

    return constraints;
  }

  private generateDependencyConstraints(
    changes: Change[],
    model: DependencyModel,
  ): Constraint[] {
    const constraints: Constraint[] = [];

    for (let i = 0; i < changes.length; i++) {
      for (let j = 0; j < changes.length; j++) {
        if (i === j) continue;

        // Determine which catalog state to use for dependency analysis
        const constraint = this.analyzeDependencyConstraint(
          i,
          changes[i],
          j,
          changes[j],
          model,
        );
        if (constraint) {
          constraints.push(constraint);
        }
      }
    }

    return constraints;
  }

  private analyzeDependencyConstraint(
    i: number,
    changeA: Change,
    j: number,
    changeB: Change,
    model: DependencyModel,
  ): Constraint | null {
    const stableIdA = changeA.stableId;
    const stableIdB = changeB.stableId;

    if (!stableIdA || !stableIdB) return null;

    // Choose appropriate catalog state for each operation
    const sourceA = changeA instanceof DropChange ? "master" : "branch";
    const sourceB = changeB instanceof DropChange ? "master" : "branch";

    // Check for dependencies in appropriate states
    const aDependsOnB = model.hasDependency(stableIdA, stableIdB, sourceA);
    const bDependsOnA = model.hasDependency(stableIdB, stableIdA, sourceB);

    // Also check without source filter for cross-catalog dependencies
    const aDependsOnBGeneral = model.hasDependency(stableIdA, stableIdB);
    const bDependsOnAGeneral = model.hasDependency(stableIdB, stableIdA);

    // Apply semantic rules
    if (aDependsOnB || aDependsOnBGeneral) {
      return this.dependencySemanticRule(
        i,
        changeA,
        j,
        changeB,
        "a_depends_on_b",
      );
    } else if (bDependsOnA || bDependsOnAGeneral) {
      return this.dependencySemanticRule(
        j,
        changeB,
        i,
        changeA,
        "b_depends_on_a",
      );
    }

    // No dependency but we might want to order the operations for styling purposes
    // But they should never impact the correctness of the script, only the order in which
    // changes get processed (eg: for functions with override, start with the one with less arguments to the one with the most number of arguments)
    return this.semanticRuleNoDependency(i, changeA, j, changeB);
  }

  private dependencySemanticRule(
    depIdx: number,
    dependentChange: Change,
    refIdx: number,
    referencedChange: Change,
    reason: string,
  ): Constraint | null {
    // TODO: Investigate and eliminate all special cases

    // Special rule: For sequence-table dependencies
    // PostgreSQL reports sequence ownership (sequence depends on table)
    // But for creation, table depends on sequence (table needs sequence to exist first)
    // If sequence depends on table, invert for all operations
    // Sequence should be created before table, and table should be dropped before sequence
    if (
      (dependentChange instanceof CreateSequence ||
        dependentChange instanceof AlterSequenceSetOwnedBy ||
        dependentChange instanceof AlterSequenceSetOptions ||
        dependentChange instanceof DropSequence ||
        dependentChange instanceof DropSequence) &&
      (referencedChange instanceof CreateTable ||
        referencedChange instanceof AlterChange ||
        referencedChange instanceof DropChange ||
        referencedChange instanceof DropTable)
    ) {
      // Special rule for AlterSequenceSetOwnedBy and CreateTable if the table uses the sequence
      // we need to first create the sequence, then then table, then set the sequence owned by the table after the table is created
      if (
        dependentChange instanceof AlterSequenceSetOwnedBy &&
        referencedChange instanceof CreateTable
      ) {
        return {
          constraintStableId: `${dependentChange.stableId} depends on ${referencedChange.stableId}`,
          changeAIndex: refIdx, // Sequence owner should come after the table is created
          type: "before",
          changeBIndex: depIdx,
          reason: `Sequence owner after the table is created (${reason})`,
        };
      }
      return {
        constraintStableId: `${dependentChange.stableId} depends on ${referencedChange.stableId}`,
        changeAIndex: depIdx, // Sequence should come first
        type: "before",
        changeBIndex: refIdx, // Before Table
        reason: `Sequence before table that uses it (${reason})`,
      };
    }

    // Rule: For DROP operations, drop dependents before dependencies
    if (
      dependentChange instanceof DropChange &&
      referencedChange instanceof DropChange
    ) {
      return {
        constraintStableId: `${dependentChange.stableId} depends on ${referencedChange.stableId}`,
        changeAIndex: depIdx,
        type: "before",
        changeBIndex: refIdx,
        reason: `DROP dependent before dependency (${reason})`,
      };
    }

    // Rule: For CREATE operations, create dependencies before dependents
    if (
      dependentChange instanceof CreateChange &&
      referencedChange instanceof CreateChange
    ) {
      return {
        constraintStableId: `${dependentChange.stableId} depends on ${referencedChange.stableId}`,
        changeAIndex: refIdx,
        type: "before",
        changeBIndex: depIdx,
        reason: `CREATE dependency before dependent (${reason})`,
      };
    }

    // Rule: For mixed CREATE/ALTER/REPLACE, create dependencies first
    if (
      (dependentChange instanceof CreateChange ||
        dependentChange instanceof AlterChange ||
        dependentChange instanceof ReplaceChange) &&
      (referencedChange instanceof CreateChange ||
        referencedChange instanceof AlterChange ||
        referencedChange instanceof ReplaceChange)
    ) {
      return {
        constraintStableId: `${dependentChange.stableId} depends on ${referencedChange.stableId}`,
        changeAIndex: refIdx,
        type: "before",
        changeBIndex: depIdx,
        reason: `CREATE/ALTER/REPLACE dependency before dependent (${reason})`,
      };
    }

    // Rule: DROP before CREATE/ALTER/REPLACE
    if (
      referencedChange instanceof DropChange &&
      (dependentChange instanceof CreateChange ||
        dependentChange instanceof AlterChange ||
        dependentChange instanceof ReplaceChange)
    ) {
      return {
        constraintStableId: `${dependentChange.stableId} depends on ${referencedChange.stableId}`,
        changeAIndex: refIdx,
        type: "before",
        changeBIndex: depIdx,
        reason: `DROP before CREATE/ALTER/REPLACE (${reason})`,
      };
    }

    return null;
  }

  private semanticRuleNoDependency(
    idxA: number,
    changeA: Change,
    idxB: number,
    changeB: Change,
  ): Constraint | null {
    // TODO: Investigate and eliminate all special cases

    // Rule: Sort function overloads by parameter types
    if (
      changeA instanceof CreateProcedure &&
      changeB instanceof CreateProcedure
    ) {
      // Given that the functions have the same name, we need to sort them by parameter types
      const procedureA = changeA.procedure;
      const procedureB = changeB.procedure;
      if (
        procedureA.schema === procedureB.schema &&
        procedureA.name === procedureB.name
      ) {
        const argumentCountA =
          procedureA.argument_count ?? procedureA.argument_types?.length ?? 0;
        const argumentCountB =
          procedureB.argument_count ?? procedureB.argument_types?.length ?? 0;
        if (argumentCountA !== argumentCountB) {
          // The overload with fewer arguments should come first
          if (argumentCountA < argumentCountB) {
            return {
              constraintStableId: `${changeA.stableId} overload before ${changeB.stableId}`,
              changeAIndex: idxA,
              type: "before",
              changeBIndex: idxB,
              reason:
                "Function overloads ordered by argument count (fewer args first)",
            };
          }
          return {
            constraintStableId: `${changeB.stableId} overload before ${changeA.stableId}`,
            changeAIndex: idxB,
            type: "before",
            changeBIndex: idxA,
            reason:
              "Function overloads ordered by argument count (fewer args first)",
          };
        }

        // Same number of args -> sort alphabetically by argument type list
        const aSig = procedureA.argument_types?.join(",") ?? "";
        const bSig = procedureB.argument_types?.join(",") ?? "";
        if (aSig !== bSig) {
          if (aSig.localeCompare(bSig) < 0) {
            return {
              constraintStableId: `${changeA.stableId} alphabetical before ${changeB.stableId}`,
              changeAIndex: idxA,
              type: "before",
              changeBIndex: idxB,
              reason:
                "Function overloads ordered alphabetically when arg count equal",
            };
          }

          return {
            constraintStableId: `${changeB.stableId} alphabetical before ${changeA.stableId}`,
            changeAIndex: idxB,
            type: "before",
            changeBIndex: idxA,
            reason:
              "Function overloads ordered alphabetically when arg count equal",
          };
        }
      }
    }

    return null;
  }

  private generateSameObjectConstraints(changes: Change[]): Constraint[] {
    const constraints: Constraint[] = [];

    // Group changes by object
    const objectGroups = new Map<string, number[]>();
    for (let i = 0; i < changes.length; i++) {
      const stableId = changes[i].stableId;
      if (stableId) {
        if (!objectGroups.has(stableId)) {
          objectGroups.set(stableId, []);
        }
        const group = objectGroups.get(stableId);
        if (group) {
          group.push(i);
        }
      }
    }

    // Add ordering constraints within each group
    for (const indices of objectGroups.values()) {
      if (indices.length > 1) {
        // Sort by operation priority
        const sortedIndices = indices.slice().sort((a, b) => {
          return (
            this.getOperationPriority(changes[a]) -
            this.getOperationPriority(changes[b])
          );
        });

        // Add sequential constraints
        for (let k = 0; k < sortedIndices.length - 1; k++) {
          constraints.push({
            constraintStableId: `${changes[sortedIndices[k]].stableId} -> ${changes[sortedIndices[k + 1]].stableId}`,
            changeAIndex: sortedIndices[k],
            type: "before",
            changeBIndex: sortedIndices[k + 1],
            reason: "Same object operation priority",
          });
        }
      }
    }

    return constraints;
  }

  private getOperationPriority(change: Change): number {
    if (change instanceof DropChange) return 0;
    if (change instanceof CreateChange) return 1; // CREATE should come before ALTER for same object
    if (change instanceof AlterChange) return 2; // ALTER should come after CREATE for same object
    if (change instanceof ReplaceChange) return 3;
    return 4;
  }
}

// utils functions to debug dependency resolution
function graphToDot(graph: Graph<string, Constraint>): string {
  const lines: string[] = ["digraph G {"];
  for (const from of graph.nodes) {
    for (const to of graph.adjacent(from) ?? []) {
      const constraint = graph.edgeProperties.get(from)?.get(to);
      if (constraint) {
        lines.push(
          `  "${from}" -> "${to}" [constraint="${constraint.constraintStableId} :: ${constraint.reason}"];`,
        );
      }
    }
  }
  lines.push("}");
  return lines.join("\n");
}

export class ConstraintSolver {
  solve(
    changes: Change[],
    constraints: Constraint[],
  ): Result<Change[], CycleError | UnexpectedError> {
    const graph = new Graph<string, Constraint>();
    const nodeIdToChange = new Map<string, Change>();
    const indexToNodeId = new Map<number, string>();
    // Helper to build unique node id per change instance (not per object)
    const getNodeId = (index: number, change: Change) =>
      `${change.stableId}#${index}`;
    // Add all changes as nodes
    for (let i = 0; i < changes.length; i++) {
      const nodeId = getNodeId(i, changes[i]);
      nodeIdToChange.set(nodeId, changes[i]);
      indexToNodeId.set(i, nodeId);
      graph.addNode(nodeId);
    }
    // Add constraint edges
    for (const constraint of constraints) {
      if (constraint.type === "before") {
        // biome-ignore lint/style/noNonNullAssertion: node ids were built from the provided changes
        const fromId = indexToNodeId.get(constraint.changeAIndex)!;
        // biome-ignore lint/style/noNonNullAssertion: node ids were built from the provided changes
        const toId = indexToNodeId.get(constraint.changeBIndex)!;
        graph.addEdge(fromId, toId, { props: constraint });
      }
    }
    // Topological sort
    try {
      const orderedNodeIds = topologicalSort(graph);
      if (DEBUG) {
        console.log("graph", graphToDot(graph));
        console.log("constraints", constraints);
      }
      return new Ok(
        // biome-ignore lint/style/noNonNullAssertion: node ids were built from the provided changes
        orderedNodeIds.map((nodeId) => nodeIdToChange.get(nodeId)!),
      );
    } catch (error) {
      if (error instanceof CycleError) {
        if (DEBUG) {
          console.log("graph", graphToDot(graph));
        }
        return new Err(error);
      }
      return new Err(new UnexpectedError("Unknown error", error));
    }
  }
}

export class DependencyResolver {
  private readonly extractor: DependencyExtractor;
  private readonly semantics: OperationSemantics;
  private readonly solver: ConstraintSolver;

  constructor(masterCatalog: Catalog, branchCatalog: Catalog) {
    this.extractor = new DependencyExtractor(masterCatalog, branchCatalog);
    this.semantics = new OperationSemantics();
    this.solver = new ConstraintSolver();
  }

  resolveDependencies(
    changes: Change[],
  ): Result<Change[], CycleError | UnexpectedError> {
    if (changes.length === 0) {
      return new Ok(changes);
    }
    const model = this.extractor.extractForChangeset(changes);
    const constraints = this.semantics.generateConstraints(changes, model);
    return this.solver.solve(changes, constraints);
  }
}

export function resolveDependencies(
  changes: Change[],
  masterCatalog: Catalog,
  branchCatalog: Catalog | null,
): Result<Change[], CycleError | UnexpectedError> {
  if (branchCatalog === null) {
    branchCatalog = emptyCatalog();
  }
  const resolver = new DependencyResolver(masterCatalog, branchCatalog);
  return resolver.resolveDependencies(changes);
}
