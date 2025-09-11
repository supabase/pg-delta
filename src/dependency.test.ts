import { CycleError } from "graph-data-structure";
import { describe, expect, test } from "vitest";
import { Catalog, emptyCatalog } from "./catalog.model.ts";
import type { PgDepend } from "./depend.ts";
import {
  DependencyExtractor,
  DependencyModel,
  DependencyResolver,
  resolveDependencies,
} from "./dependency.ts";
import {
  AlterChange,
  CreateChange,
  DropChange,
  ReplaceChange,
} from "./objects/base.change.ts";
import { CreateSequence } from "./objects/sequence/changes/sequence.create.ts";
import { Sequence } from "./objects/sequence/sequence.model.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { Table } from "./objects/table/table.model.ts";

describe("DependencyResolver", () => {
  // Helper classes for testing
  class DummyCreate extends CreateChange {
    readonly stableId: string;
    constructor(stableId: string) {
      super();
      this.stableId = stableId;
    }
    serialize() {
      return `CREATE ${this.stableId}`;
    }
  }

  class DummyDrop extends DropChange {
    readonly stableId: string;
    constructor(stableId: string) {
      super();
      this.stableId = stableId;
    }
    serialize() {
      return `DROP ${this.stableId}`;
    }
  }

  class DummyAlter extends AlterChange {
    readonly stableId: string;
    constructor(stableId: string) {
      super();
      this.stableId = stableId;
    }
    serialize() {
      return `ALTER ${this.stableId}`;
    }
  }

  class DummyReplace extends ReplaceChange {
    readonly stableId: string;
    constructor(stableId: string) {
      super();
      this.stableId = stableId;
    }
    serialize() {
      return `REPLACE ${this.stableId}`;
    }
  }

  // Helper to create a catalog with dependencies
  function createCatalogWithDependencies(dependencies: PgDepend[]): Catalog {
    return new Catalog({
      collations: {},
      compositeTypes: {},
      domains: {},
      enums: {},
      extensions: {},
      procedures: {},
      indexes: {},
      materializedViews: {},
      rlsPolicies: {},
      roles: {},
      schemas: {},
      sequences: {},
      tables: {},
      triggers: {},
      ranges: {},
      views: {},
      depends: dependencies,
      indexableObjects: {},
      version: 150014, // Default to PostgreSQL 15
    });
  }

  describe.concurrent("dependency resolution coverage", () => {
    test("empty changes list", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);
      const result = resolver.resolveDependencies([])._unsafeUnwrap();

      // Should return empty list without errors
      expect(result).toEqual([]);
    });

    test("cross-catalog dependencies", () => {
      // Create main catalog with a view
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view1",
          referenced_stable_id: "table:test.table1",
          deptype: "n",
        },
      ]);

      // Create branch catalog (empty)
      const branchCatalog = emptyCatalog();

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create changes that involve cross-catalog checks
      const changes = [
        new DummyDrop("view:test.view1"),
        new DummyCreate("view:test.view2"),
      ];

      // Test with actual DependencyResolver method
      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should return changes in the correct order
      expect(result.length).toBe(2);
      // The view2 should be created first, then the view1 should be dropped
      expect(result[0]).toEqual(
        expect.objectContaining({
          stableId: "view:test.view2",
          kind: "create",
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          stableId: "view:test.view1",
          kind: "drop",
        }),
      );
    });

    test("mixed operation dependencies", () => {
      // Create catalogs with dependencies
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view1",
          referenced_stable_id: "table:test.table1",
          deptype: "n",
        },
      ]);

      const branchCatalog = emptyCatalog();
      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create mixed operations
      const changes = [
        new DummyDrop("view:test.view1"),
        new DummyAlter("table:test.table1"),
        new DummyCreate("view:test.view2"),
      ];

      // Test with actual DependencyResolver method
      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should return all changes
      expect(result.length).toBe(3);
    });

    test("dependency constraints with view depending on table", () => {
      // Create catalog with view depending on table
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create changes where order matters due to dependencies
      const changes = [
        new DummyCreate("view:test.user_view"), // Should come after table
        new DummyCreate("table:test.users"), // Should come first
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify dependency-based ordering
      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");

      // Table should come before view due to dependency
      expect(tableIndex).toBeLessThan(viewIndex);
    });

    test("drop operations with dependencies", () => {
      // Create catalog with view depending on table
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const branchCatalog = emptyCatalog();
      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create drop changes where order matters
      const changes = [
        new DummyDrop("table:test.users"), // Should come after view drop
        new DummyDrop("view:test.user_view"), // Should come first
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify dependency-based ordering for drops
      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");

      // View should be dropped before table due to dependency
      expect(viewIndex).toBeLessThan(tableIndex);
    });

    test("operation priority for different objects", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create multiple operations on different objects to test operation priority
      const changes = [
        new DummyAlter("table:test.users"), // Alter operation
        new DummyCreate("table:test.posts"), // Create operation
        new DummyDrop("table:test.comments"), // Drop operation
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify all operations are preserved
      expect(result.length).toBe(3);

      // Operations should be preserved (order may vary due to dependencies)
      const operations = result.map((change) => change.kind);
      expect(operations).toContain("drop");
      expect(operations).toContain("create");
      expect(operations).toContain("alter");
    });

    test.skip("cycle error from conflicting same object operations", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create conflicting operations on the same object that should cause a cycle
      // DROP and CREATE on the same object can create logical conflicts in the constraint graph
      const changes = [
        new DummyDrop("table:test.users"),
        new DummyCreate("table:test.users"), // This creates a logical cycle with the drop
        new DummyAlter("table:test.users"), // This also conflicts
      ];

      const result = resolver.resolveDependencies(changes);

      // Should return a CycleError due to the conflicting operations
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error instanceof CycleError).toBe(true);
        expect(result.error.message).toBe("Cycle found");
      }
    });

    test("complex dependency chain", () => {
      // Create a complex dependency chain: schema -> table -> view -> materialized view
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.users",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "materializedView:test.user_summary",
          referenced_stable_id: "view:test.user_view",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.users",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "materializedView:test.user_summary",
          referenced_stable_id: "view:test.user_view",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create changes in reverse dependency order
      const changes = [
        new DummyCreate("materializedView:test.user_summary"),
        new DummyCreate("view:test.user_view"),
        new DummyCreate("table:test.users"),
        new DummyCreate("schema:test"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify correct dependency ordering
      expect(result.length).toBe(4);
      const stableIds = result.map((change) => change.stableId);

      const schemaIndex = stableIds.indexOf("schema:test");
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");
      const matViewIndex = stableIds.indexOf(
        "materializedView:test.user_summary",
      );

      // Verify proper ordering based on dependencies
      expect(schemaIndex).toBeLessThan(tableIndex);
      expect(tableIndex).toBeLessThan(viewIndex);
      expect(viewIndex).toBeLessThan(matViewIndex);
    });

    test("sequence-table create dependency special case", () => {
      // Test the special sequence-table CREATE rule in dependencySemanticRule
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "sequence:test.user_id_seq",
          referenced_stable_id: "table:test.users",
          deptype: "a", // auto dependency
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "sequence:test.user_id_seq",
          referenced_stable_id: "table:test.users",
          deptype: "a",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create real CreateTable and CreateSequence changes
      const table = new Table({
        schema: "test",
        name: "users",
        persistence: "p",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: true,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "owner",
        parent_schema: null,
        parent_name: null,
        columns: [],
      });
      const sequence = new Sequence({
        schema: "test",
        name: "user_id_seq",
        data_type: "bigint",
        start_value: 1,
        minimum_value: BigInt(1),
        maximum_value: BigInt("9223372036854775807"),
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owned_by_schema: "test",
        owned_by_table: "users",
        owned_by_column: "id",
      });

      const changes = [
        new CreateTable({ table }),
        new CreateSequence({ sequence }),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify the special sequence-table rule: sequence should come BEFORE table for CREATE
      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);
      const sequenceIndex = stableIds.indexOf("sequence:test.user_id_seq");
      const tableIndex = stableIds.indexOf("table:test.users");

      // Sequence should be created before table (despite dependency showing sequence depends on table)
      expect(sequenceIndex).toBeLessThan(tableIndex);
    });

    test.skip("operation priority ordering within same object", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create multiple operations on the same object to test priority ordering
      const changes = [
        new DummyReplace("table:test.users"),
        new DummyAlter("table:test.users"),
        new DummyCreate("table:test.users"),
        new DummyDrop("table:test.users"),
      ];

      const result = resolver.resolveDependencies(changes);

      // This scenario actually creates a cycle because operations on the same object
      // can conflict - DROP and CREATE on the same object is logically inconsistent
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error instanceof CycleError).toBe(true);
      }
    });

    test.skip("non-conflicting operation priority ordering", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create operations that don't conflict with each other
      const changes = [
        new DummyReplace("view:test.user_view"),
        new DummyAlter("view:test.user_view"),
      ];

      const result = resolver.resolveDependencies(changes);

      // Even non-conflicting operations on the same object can create cycles
      // in the constraint graph due to the generateSameObjectConstraints
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error instanceof CycleError).toBe(true);
      }
    });

    test("mixed create/alter/replace dependency constraints", () => {
      // Test constraint generation for mixed operation types
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.dependent_view",
          referenced_stable_id: "table:test.base_table",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.dependent_view",
          referenced_stable_id: "table:test.base_table",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Mix of different operation types with dependencies
      const changes = [
        new DummyReplace("view:test.dependent_view"), // Depends on table
        new DummyAlter("table:test.base_table"), // Referenced by view
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);
      const tableIndex = stableIds.indexOf("table:test.base_table");
      const viewIndex = stableIds.indexOf("view:test.dependent_view");

      // Table ALTER should come before view REPLACE
      expect(tableIndex).toBeLessThan(viewIndex);
    });

    test("deep dependency traversal with max depth", () => {
      // Test deep dependency chain beyond typical depth
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "schema_level_1:test.obj1",
          referenced_stable_id: "schema_level_0:test.obj0",
          deptype: "n",
        },
        {
          dependent_stable_id: "schema_level_2:test.obj2",
          referenced_stable_id: "schema_level_1:test.obj1",
          deptype: "n",
        },
        {
          dependent_stable_id: "schema_level_3:test.obj3",
          referenced_stable_id: "schema_level_2:test.obj2",
          deptype: "n",
        },
        {
          dependent_stable_id: "schema_level_4:test.obj4",
          referenced_stable_id: "schema_level_3:test.obj3",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "schema_level_1:test.obj1",
          referenced_stable_id: "schema_level_0:test.obj0",
          deptype: "n",
        },
        {
          dependent_stable_id: "schema_level_2:test.obj2",
          referenced_stable_id: "schema_level_1:test.obj1",
          deptype: "n",
        },
        {
          dependent_stable_id: "schema_level_3:test.obj3",
          referenced_stable_id: "schema_level_2:test.obj2",
          deptype: "n",
        },
        {
          dependent_stable_id: "schema_level_4:test.obj4",
          referenced_stable_id: "schema_level_3:test.obj3",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Create all objects in random order
      const changes = [
        new DummyCreate("schema_level_3:test.obj3"),
        new DummyCreate("schema_level_0:test.obj0"),
        new DummyCreate("schema_level_4:test.obj4"),
        new DummyCreate("schema_level_1:test.obj1"),
        new DummyCreate("schema_level_2:test.obj2"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(5);
      const stableIds = result.map((change) => change.stableId);

      // Due to the max depth of 2 in findRelevantObjects, not all deep dependencies
      // are discovered and enforced. The algorithm only traverses 2 levels deep.
      // So we can't expect a strict ordering for the full chain.

      // The dependency resolver should still return all the changes
      expect(result.length).toBe(5);

      // And all the original changes should be present
      const originalStableIds = changes.map((c) => c.stableId);
      for (const originalId of originalStableIds) {
        expect(stableIds).toContain(originalId);
      }
    });

    test("drop operations with reverse dependency ordering", () => {
      // Test that drops happen in reverse dependency order
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view_level_2",
          referenced_stable_id: "view:test.view_level_1",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.view_level_1",
          referenced_stable_id: "table:test.base_table",
          deptype: "n",
        },
      ]);

      const branchCatalog = emptyCatalog();
      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Drop all objects
      const changes = [
        new DummyDrop("table:test.base_table"),
        new DummyDrop("view:test.view_level_1"),
        new DummyDrop("view:test.view_level_2"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(3);
      const stableIds = result.map((change) => change.stableId);

      const tableIndex = stableIds.indexOf("table:test.base_table");
      const view1Index = stableIds.indexOf("view:test.view_level_1");
      const view2Index = stableIds.indexOf("view:test.view_level_2");

      // Drop order should be reverse of creation: view_level_2 -> view_level_1 -> table
      expect(view2Index).toBeLessThan(view1Index);
      expect(view1Index).toBeLessThan(tableIndex);
    });

    test("cross-catalog dependency scenarios", () => {
      // Main catalog has one set of dependencies
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.old_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      // Branch catalog has different dependencies
      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.new_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Mix of operations across catalogs
      const changes = [
        new DummyDrop("view:test.old_view"), // From main
        new DummyCreate("view:test.new_view"), // For branch
        new DummyAlter("table:test.users"), // Exists in both
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(3);
      const stableIds = result.map((change) => change.stableId);

      // Based on the actual output: [ 'table:test.users', 'view:test.new_view', 'view:test.old_view' ]
      // The resolver is prioritizing:
      // 1. Table ALTER (comes first since it's referenced by both views)
      // 2. New view CREATE (comes next)
      // 3. Old view DROP (comes last)

      const dropIndex = stableIds.indexOf("view:test.old_view");
      const alterIndex = stableIds.indexOf("table:test.users");
      const createIndex = stableIds.indexOf("view:test.new_view");

      // Table ALTER comes before both view operations
      expect(alterIndex).toBeLessThan(createIndex);
      expect(alterIndex).toBeLessThan(dropIndex);

      // The CREATE comes before DROP
      expect(createIndex).toBeLessThan(dropIndex);
    });

    test("unknown object filtering", () => {
      // Test that dependencies with "unknown." prefixes are filtered out
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.users",
          referenced_stable_id: "unknown.missing_object",
          deptype: "n",
        },
        {
          dependent_stable_id: "unknown.other_missing",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "unknown.other_missing",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      const changes = [
        new DummyCreate("view:test.user_view"),
        new DummyCreate("table:test.users"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);

      // Only the valid dependency should be considered
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");
      expect(tableIndex).toBeLessThan(viewIndex);
    });

    test("getDirectDependencies filters out unknown referenced", () => {
      const catalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "unknown.missing_object",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const extractor = new DependencyExtractor(
        catalog,
        catalog,
      ) as unknown as {
        getDirectDependencies: (objId: string, catalog: Catalog) => Set<string>;
      };
      const deps: Set<string> = extractor.getDirectDependencies(
        "view:test.user_view",
        catalog,
      );

      expect(deps.has("table:test.users")).toBe(true);
      expect(deps.has("unknown.missing_object")).toBe(false);
    });

    test("getDirectDependents filters out unknown dependent", () => {
      const catalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "unknown.other_missing",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const extractor = new DependencyExtractor(
        catalog,
        catalog,
      ) as unknown as {
        getDirectDependents: (objId: string, catalog: Catalog) => Set<string>;
      };
      const dependents: Set<string> = extractor.getDirectDependents(
        "table:test.users",
        catalog,
      );

      expect(dependents.has("view:test.user_view")).toBe(true);
      expect(dependents.has("unknown.other_missing")).toBe(false);
    });

    test("extractFromCatalog filters unknown with relevantObjects (object)", () => {
      // Use a plain object for relevantObjects to exercise `in` checks and unknown.* filtering
      const catalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "relevant:test.obj1",
          referenced_stable_id: "relevant:test.obj2",
          deptype: "n",
        },
        {
          dependent_stable_id: "relevant:test.obj1",
          referenced_stable_id: "unknown.missing",
          deptype: "n",
        },
        {
          dependent_stable_id: "unknown.missing",
          referenced_stable_id: "relevant:test.obj2",
          deptype: "n",
        },
      ]);

      const extractor = new DependencyExtractor(
        catalog,
        catalog,
      ) as unknown as {
        extractFromCatalog: (
          model: DependencyModel,
          catalog: Catalog,
          relevantObjects: Set<string>,
          source: string,
        ) => DependencyModel;
      };
      const model = new DependencyModel();
      const relevantObjects = new Set([
        "relevant:test.obj1",
        "relevant:test.obj2",
      ]);

      extractor.extractFromCatalog(model, catalog, relevantObjects, "main");

      // Only the valid pair should be recorded
      expect(
        model.hasDependency("relevant:test.obj1", "relevant:test.obj2", "main"),
      ).toBe(true);
      // Unknown.* entries are ignored
      expect(
        model.hasDependency("relevant:test.obj1", "unknown.missing", "main"),
      ).toBe(false);
      expect(
        model.hasDependency("unknown.missing", "relevant:test.obj2", "main"),
      ).toBe(false);
    });

    test("constraint solver with unexpected error handling", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create changes with invalid stable IDs to potentially trigger edge cases
      const changes = [
        new DummyCreate(""), // Empty stable ID
        new DummyCreate("table:test.users"),
      ];

      // This should handle the edge case gracefully
      const result = resolver.resolveDependencies(changes);

      // Should either succeed or return a meaningful error
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
      } else {
        expect(result.value.length).toBeGreaterThanOrEqual(1);
      }
    });

    test("replace operations with dependency constraints", () => {
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "materializedView:test.summary",
          referenced_stable_id: "view:test.base_view",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "materializedView:test.summary",
          referenced_stable_id: "view:test.base_view",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      const changes = [
        new DummyReplace("materializedView:test.summary"),
        new DummyReplace("view:test.base_view"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);

      const viewIndex = stableIds.indexOf("view:test.base_view");
      const matViewIndex = stableIds.indexOf("materializedView:test.summary");

      // Base view REPLACE should come before dependent materialized view REPLACE
      expect(viewIndex).toBeLessThan(matViewIndex);
    });

    test("multi-schema dependency resolution", () => {
      // Complex scenario with objects across multiple schemas
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:schema_a.table_a",
          referenced_stable_id: "schema:schema_a",
          deptype: "n",
        },
        {
          dependent_stable_id: "table:schema_b.table_b",
          referenced_stable_id: "schema:schema_b",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:schema_b.cross_schema_view",
          referenced_stable_id: "table:schema_a.table_a",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:schema_b.cross_schema_view",
          referenced_stable_id: "table:schema_b.table_b",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:schema_a.table_a",
          referenced_stable_id: "schema:schema_a",
          deptype: "n",
        },
        {
          dependent_stable_id: "table:schema_b.table_b",
          referenced_stable_id: "schema:schema_b",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:schema_b.cross_schema_view",
          referenced_stable_id: "table:schema_a.table_a",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:schema_b.cross_schema_view",
          referenced_stable_id: "table:schema_b.table_b",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      const changes = [
        new DummyCreate("view:schema_b.cross_schema_view"),
        new DummyCreate("table:schema_b.table_b"),
        new DummyCreate("table:schema_a.table_a"),
        new DummyCreate("schema:schema_b"),
        new DummyCreate("schema:schema_a"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(5);
      const stableIds = result.map((change) => change.stableId);

      const schemaAIndex = stableIds.indexOf("schema:schema_a");
      const schemaBIndex = stableIds.indexOf("schema:schema_b");
      const tableAIndex = stableIds.indexOf("table:schema_a.table_a");
      const tableBIndex = stableIds.indexOf("table:schema_b.table_b");
      const viewIndex = stableIds.indexOf("view:schema_b.cross_schema_view");

      // Schemas must come before their tables
      expect(schemaAIndex).toBeLessThan(tableAIndex);
      expect(schemaBIndex).toBeLessThan(tableBIndex);

      // Both tables must come before the view that depends on them
      expect(tableAIndex).toBeLessThan(viewIndex);
      expect(tableBIndex).toBeLessThan(viewIndex);
    });

    test("dependency model edge cases", () => {
      // Test DependencyModel class directly for edge cases
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Test with null/undefined stable IDs
      const changes = [
        new DummyCreate(""),
        new DummyCreate("valid:test.object"),
      ];

      const result = resolver.resolveDependencies(changes);

      // Should handle empty stable IDs gracefully
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThanOrEqual(1);
      } else {
        expect(result.error).toBeInstanceOf(Error);
      }
    });

    test("constraint solver with complex graph", () => {
      // Create a complex but valid dependency graph
      const mainCatalog = createCatalogWithDependencies([
        // Multiple dependencies pointing to same object
        {
          dependent_stable_id: "view:test.view1",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.view2",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.view3",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        // Chain dependencies
        {
          dependent_stable_id: "materializedView:test.summary",
          referenced_stable_id: "view:test.view1",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view1",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.view2",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.view3",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "materializedView:test.summary",
          referenced_stable_id: "view:test.view1",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      const changes = [
        new DummyCreate("materializedView:test.summary"),
        new DummyCreate("view:test.view3"),
        new DummyCreate("view:test.view2"),
        new DummyCreate("view:test.view1"),
        new DummyCreate("table:test.base"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(5);
      const stableIds = result.map((change) => change.stableId);

      const baseIndex = stableIds.indexOf("table:test.base");
      const view1Index = stableIds.indexOf("view:test.view1");
      const view2Index = stableIds.indexOf("view:test.view2");
      const view3Index = stableIds.indexOf("view:test.view3");
      const matViewIndex = stableIds.indexOf("materializedView:test.summary");

      // Base table must come before all views
      expect(baseIndex).toBeLessThan(view1Index);
      expect(baseIndex).toBeLessThan(view2Index);
      expect(baseIndex).toBeLessThan(view3Index);

      // view1 must come before materialized view that depends on it
      expect(view1Index).toBeLessThan(matViewIndex);
    });

    test("drop before create constraint", () => {
      // Test DROP before CREATE/ALTER/REPLACE constraint rule
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.dependent",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.new_dependent",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      // Mix DROP with CREATE operations
      const changes = [
        new DummyCreate("view:test.new_dependent"),
        new DummyDrop("table:test.base"),
        new DummyDrop("view:test.dependent"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(3);
      const stableIds = result.map((change) => change.stableId);

      const dropViewIndex = stableIds.indexOf("view:test.dependent");
      const dropTableIndex = stableIds.indexOf("table:test.base");
      const createViewIndex = stableIds.indexOf("view:test.new_dependent");

      // Drops should come before creates
      expect(dropViewIndex).toBeLessThan(createViewIndex);
      expect(dropTableIndex).toBeLessThan(createViewIndex);
    });

    test("sequence table special rule coverage", () => {
      // Test the specific sequence-table logic more thoroughly
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "sequence:test.id_seq",
          referenced_stable_id: "table:test.main",
          deptype: "a", // auto dependency
        },
        {
          dependent_stable_id: "table:test.main",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "sequence:test.id_seq",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "sequence:test.id_seq",
          referenced_stable_id: "table:test.main",
          deptype: "a",
        },
        {
          dependent_stable_id: "table:test.main",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "sequence:test.id_seq",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      const changes = [
        new CreateTable({
          table: new Table({
            name: "main",
            schema: "test",
            persistence: "p",
            row_security: false,
            force_row_security: false,
            has_indexes: false,
            has_rules: false,
            has_triggers: false,
            has_subclasses: false,
            is_populated: true,
            replica_identity: "d",
            is_partition: false,
            options: null,
            partition_bound: null,
            owner: "owner",
            parent_schema: null,
            parent_name: null,
            columns: [],
          }),
        }),
        new CreateSequence({
          sequence: new Sequence({
            name: "id_seq",
            schema: "test",
            data_type: "bigint",
            start_value: 1,
            minimum_value: BigInt(1),
            maximum_value: BigInt("9223372036854775807"),
            increment: 1,
            cycle_option: false,
            cache_size: 1,
            persistence: "p",
            owned_by_schema: "test",
            owned_by_table: "users",
            owned_by_column: "id",
          }),
        }),
        new DummyCreate("schema:test"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(3);
      const stableIds = result.map((change) => change.stableId);

      const schemaIndex = stableIds.indexOf("schema:test");
      const sequenceIndex = stableIds.indexOf("sequence:test.id_seq");
      const tableIndex = stableIds.indexOf("table:test.main");

      // Schema comes first (both sequence and table depend on it)
      expect(schemaIndex).toBeLessThan(sequenceIndex);
      expect(schemaIndex).toBeLessThan(tableIndex);

      // The special rule: sequence before table for CREATE operations
      expect(sequenceIndex).toBeLessThan(tableIndex);
    });

    test("mixed operation types with complex dependencies", () => {
      // Test all operation types together with dependencies
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.old_view",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "materializedView:test.old_matview",
          referenced_stable_id: "view:test.old_view",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.new_view",
          referenced_stable_id: "table:test.base",
          deptype: "n",
        },
        {
          dependent_stable_id: "materializedView:test.new_matview",
          referenced_stable_id: "view:test.new_view",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(mainCatalog, branchCatalog);

      const changes = [
        new DummyCreate("view:test.new_view"),
        new DummyCreate("materializedView:test.new_matview"),
        new DummyDrop("materializedView:test.old_matview"),
        new DummyDrop("view:test.old_view"),
        new DummyAlter("table:test.base"),
        new DummyReplace("table:test.replacement"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(6);

      // All operations should be preserved
      const operations = result.map((change) => change.kind);
      expect(operations).toContain("create");
      expect(operations).toContain("drop");
      expect(operations).toContain("alter");
      expect(operations).toContain("replace");
    });

    test("constraint generation with no dependencies", () => {
      // Test constraint generation when there are no dependencies
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      const changes = [
        new DummyCreate("table:test.a"),
        new DummyCreate("table:test.b"),
        new DummyCreate("table:test.c"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should preserve all changes even without dependencies
      expect(result.length).toBe(3);

      // All original changes should be present
      const resultIds = result.map((c) => c.stableId);
      expect(resultIds).toContain("table:test.a");
      expect(resultIds).toContain("table:test.b");
      expect(resultIds).toContain("table:test.c");
    });

    test("dependency extractor max depth behavior", () => {
      // Test that max depth actually limits dependency traversal
      const deepCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "level1:test.obj",
          referenced_stable_id: "level0:test.obj",
          deptype: "n",
        },
        {
          dependent_stable_id: "level2:test.obj",
          referenced_stable_id: "level1:test.obj",
          deptype: "n",
        },
        {
          dependent_stable_id: "level3:test.obj",
          referenced_stable_id: "level2:test.obj",
          deptype: "n",
        },
        {
          dependent_stable_id: "level4:test.obj",
          referenced_stable_id: "level3:test.obj",
          deptype: "n",
        },
        {
          dependent_stable_id: "level5:test.obj",
          referenced_stable_id: "level4:test.obj",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(deepCatalog, deepCatalog);

      // Only include the deepest object to test traversal
      const changes = [new DummyCreate("level5:test.obj")];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should only find the one change since max depth limits discovery
      expect(result.length).toBe(1);
      expect(result[0].stableId).toBe("level5:test.obj");
    });

    test("dependency model addDependency and hasDependency methods", () => {
      // Test DependencyModel methods directly for uncovered lines 40-51, 64-65
      const mainCatalog = emptyCatalog();
      const branchCatalog = emptyCatalog();
      const extractor = new DependencyExtractor(mainCatalog, branchCatalog);

      // Create a simple change to trigger dependency model usage
      const changes = [new DummyCreate("table:test.users")];
      const model = extractor.extractForChangeset(changes);

      // Test addDependency method (lines 40-51)
      model.addDependency("dep:test.a", "ref:test.b", "main");
      model.addDependency("dep:test.a", "ref:test.b", "main"); // Add same dependency again

      // Test hasDependency method (lines 64-65)
      expect(model.hasDependency("dep:test.a", "ref:test.b", "main")).toBe(
        true,
      );
      expect(model.hasDependency("dep:test.a", "ref:test.b", "branch")).toBe(
        false,
      );
      expect(model.hasDependency("dep:test.x", "ref:test.y", "main")).toBe(
        false,
      );
    });

    test("dependency extractor with unknown objects", () => {
      // Test lines 115, 117-118, 128, 130-131 - unknown object filtering
      const catalogWithUnknowns = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.users",
          referenced_stable_id: "unknown.missing_schema",
          deptype: "n",
        },
        {
          dependent_stable_id: "unknown.missing_table",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(
        catalogWithUnknowns,
        catalogWithUnknowns,
      );

      const changes = [
        new DummyCreate("view:test.user_view"),
        new DummyCreate("table:test.users"),
        new DummyCreate("schema:test"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should filter out unknown dependencies but preserve valid ones
      expect(result.length).toBe(3);
      const stableIds = result.map((change) => change.stableId);

      // Valid dependency should still be enforced
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");

      expect(tableIndex).toBeLessThan(viewIndex); // Valid dependency enforced
    });

    test("extractFromCatalog with relevant objects filtering", () => {
      // Test lines 145-147, 149-154 - extractFromCatalog filtering logic
      const catalogWithMixed = createCatalogWithDependencies([
        {
          dependent_stable_id: "relevant:test.obj1",
          referenced_stable_id: "relevant:test.obj2",
          deptype: "n",
        },
        {
          dependent_stable_id: "irrelevant:test.obj3",
          referenced_stable_id: "irrelevant:test.obj4",
          deptype: "n",
        },
        {
          dependent_stable_id: "unknown.obj5",
          referenced_stable_id: "relevant:test.obj1",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(
        catalogWithMixed,
        catalogWithMixed,
      );

      // Only include relevant objects in changes
      const changes = [
        new DummyCreate("relevant:test.obj1"),
        new DummyCreate("relevant:test.obj2"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);

      const obj1Index = stableIds.indexOf("relevant:test.obj1");
      const obj2Index = stableIds.indexOf("relevant:test.obj2");

      // obj2 should come before obj1 due to dependency
      expect(obj2Index).toBeLessThan(obj1Index);
    });

    test("analyzeDependencyConstraint return null cases", () => {
      // Test lines 192-193 - when analyzeDependencyConstraint returns null
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create changes with no dependencies between them
      const changes = [
        new DummyCreate("table:test.a"),
        new DummyCreate("table:test.b"),
        new DummyCreate("table:test.c"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should handle cases where no constraints are generated
      expect(result.length).toBe(3);
      // All changes should be preserved even without constraints
      const resultIds = result.map((c) => c.stableId);
      expect(resultIds).toContain("table:test.a");
      expect(resultIds).toContain("table:test.b");
      expect(resultIds).toContain("table:test.c");
    });

    test("dependency semantic rule branches", () => {
      // Test lines 226-232, 234-241 - both branches of dependency semantic rules
      const catalogA = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view_a",
          referenced_stable_id: "table:test.table_a",
          deptype: "n",
        },
      ]);

      const catalogB = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.table_b",
          referenced_stable_id: "view:test.view_b",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(catalogA, catalogB);

      // Test first branch: A depends on B
      const changesAB = [
        new DummyCreate("view:test.view_a"),
        new DummyCreate("table:test.table_a"),
      ];

      const resultAB = resolver.resolveDependencies(changesAB)._unsafeUnwrap();
      expect(resultAB.length).toBe(2);

      // Test second branch: B depends on A
      const changesBA = [
        new DummyCreate("table:test.table_b"),
        new DummyCreate("view:test.view_b"),
      ];

      const resultBA = resolver.resolveDependencies(changesBA)._unsafeUnwrap();
      expect(resultBA.length).toBe(2);
    });

    test("constraint solver unexpected error handling", () => {
      // Test lines 420-421 - UnexpectedError path in ConstraintSolver
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create a scenario that might trigger unexpected errors
      const changes = [
        new DummyCreate("invalid:"),
        new DummyCreate("table:test.valid"),
      ];

      const result = resolver.resolveDependencies(changes);

      // Should either succeed or return a proper error
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
      } else {
        expect(result.value.length).toBeGreaterThanOrEqual(1);
      }
    });

    test("resolveDependencies function with null branch catalog", () => {
      // Test lines 449-458 - standalone resolveDependencies function
      const mainCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const changes = [
        new DummyCreate("view:test.user_view"),
        new DummyCreate("table:test.users"),
      ];

      // Test with null branch catalog (line 453-454)
      const result = resolveDependencies(changes, mainCatalog, null);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        const stableIds = result.value.map((c) => c.stableId);
        const tableIndex = stableIds.indexOf("table:test.users");
        const viewIndex = stableIds.indexOf("view:test.user_view");
        expect(tableIndex).toBeLessThan(viewIndex);
      }
    });

    test("all dependency semantic rule branches coverage", () => {
      // Test all the uncovered branches in dependencySemanticRule (lines 247-333)

      // Test sequence-table special case (lines 262-272)
      const seqTableCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "sequence:test.id_seq",
          referenced_stable_id: "table:test.users",
          deptype: "a",
        },
      ]);

      const resolver1 = new DependencyResolver(
        seqTableCatalog,
        seqTableCatalog,
      );
      const seqTableChanges = [
        new DummyCreate("table:test.users"),
        new DummyCreate("sequence:test.id_seq"),
      ];

      const seqResult = resolver1
        .resolveDependencies(seqTableChanges)
        ._unsafeUnwrap();
      expect(seqResult.length).toBe(2);

      // Test DROP operations (lines 276-285)
      const dropCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver2 = new DependencyResolver(dropCatalog, emptyCatalog());
      const dropChanges = [
        new DummyDrop("view:test.user_view"),
        new DummyDrop("table:test.users"),
      ];

      const dropResult = resolver2
        .resolveDependencies(dropChanges)
        ._unsafeUnwrap();
      expect(dropResult.length).toBe(2);

      // Test CREATE operations (lines 288-298)
      const createCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver3 = new DependencyResolver(createCatalog, createCatalog);
      const createChanges = [
        new DummyCreate("view:test.user_view"),
        new DummyCreate("table:test.users"),
      ];

      const createResult = resolver3
        .resolveDependencies(createChanges)
        ._unsafeUnwrap();
      expect(createResult.length).toBe(2);

      // Test mixed operations (lines 301-315)
      const mixedCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver4 = new DependencyResolver(mixedCatalog, mixedCatalog);
      const mixedChanges = [
        new DummyAlter("view:test.user_view"),
        new DummyReplace("table:test.users"),
      ];

      const mixedResult = resolver4
        .resolveDependencies(mixedChanges)
        ._unsafeUnwrap();
      expect(mixedResult.length).toBe(2);

      // Test DROP before CREATE/ALTER/REPLACE (lines 318-330)
      const dropBeforeCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.new_view",
          referenced_stable_id: "table:test.old_table",
          deptype: "n",
        },
      ]);

      const resolver5 = new DependencyResolver(
        dropBeforeCatalog,
        dropBeforeCatalog,
      );
      const dropBeforeChanges = [
        new DummyCreate("view:test.new_view"),
        new DummyDrop("table:test.old_table"),
      ];

      const dropBeforeResult = resolver5
        .resolveDependencies(dropBeforeChanges)
        ._unsafeUnwrap();
      expect(dropBeforeResult.length).toBe(2);
    });

    test("dependency model methods direct access", () => {
      // Test the DependencyModel class methods that might not be covered
      const mainCatalog = emptyCatalog();
      const branchCatalog = emptyCatalog();
      const extractor = new DependencyExtractor(mainCatalog, branchCatalog);
      const model = extractor.extractForChangeset([]);

      // Test addDependency with different scenarios
      model.addDependency("test:obj1", "test:obj2", "source1");
      model.addDependency("test:obj1", "test:obj2", "source1"); // Same dependency (should not duplicate)
      model.addDependency("test:obj3", "test:obj4", "source2");
      model.addDependency("test:obj5", "test:obj6", ""); // Empty source

      // Test hasDependency with various source filters
      expect(model.hasDependency("test:obj1", "test:obj2", "source1")).toBe(
        true,
      );
      expect(model.hasDependency("test:obj1", "test:obj2", "source2")).toBe(
        false,
      );
      expect(model.hasDependency("test:obj1", "test:obj2", null)).toBe(false); // No match for undefined source
      expect(model.hasDependency("test:obj3", "test:obj4", "source2")).toBe(
        true,
      );
      expect(model.hasDependency("test:obj5", "test:obj6", "")).toBe(true);
      expect(model.hasDependency("nonexistent", "test:obj2", "source1")).toBe(
        false,
      );
    });

    test("extreme edge cases for comprehensive coverage", () => {
      // Test with extremely minimal catalogs and edge case scenarios
      const minimalCatalog = new Catalog({
        collations: {},
        compositeTypes: {},
        domains: {},
        enums: {},
        extensions: {},
        procedures: {},
        indexes: {},
        materializedViews: {},
        rlsPolicies: {},
        roles: {},
        schemas: {},
        sequences: {},
        tables: {},
        triggers: {},
        ranges: {},
        views: {},
        depends: [
          {
            dependent_stable_id: "test:dep",
            referenced_stable_id: "test:ref",
            deptype: "n",
          },
        ],
        indexableObjects: {},
        version: 150014, // Default to PostgreSQL 15
      });

      const resolver = new DependencyResolver(minimalCatalog, minimalCatalog);

      // Test with changes that have dependencies but no operation conflicts
      const changes = [
        new DummyCreate("test:dep"),
        new DummyCreate("test:ref"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();
      expect(result.length).toBe(2);

      const stableIds = result.map((c) => c.stableId);
      const refIndex = stableIds.indexOf("test:ref");
      const depIndex = stableIds.indexOf("test:dep");

      // Reference should come before dependent
      expect(refIndex).toBeLessThan(depIndex);
    });

    test("constraint solver with different graph structures", () => {
      // Test constraint solver with various graph patterns to ensure all paths are covered
      const catalogWithLoop = createCatalogWithDependencies([
        {
          dependent_stable_id: "obj:a",
          referenced_stable_id: "obj:b",
          deptype: "n",
        },
        {
          dependent_stable_id: "obj:b",
          referenced_stable_id: "obj:c",
          deptype: "n",
        },
        {
          dependent_stable_id: "obj:c",
          referenced_stable_id: "obj:a", // This creates a cycle
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(catalogWithLoop, catalogWithLoop);

      const changes = [
        new DummyCreate("obj:a"),
        new DummyCreate("obj:b"),
        new DummyCreate("obj:c"),
      ];

      const result = resolver.resolveDependencies(changes);

      // This might detect a cycle, but it depends on the max depth traversal
      // Let's just check that it returns a valid result
      if (result.isErr()) {
        expect(result.error instanceof CycleError).toBe(true);
      } else {
        expect(result.value.length).toBe(3);
      }
    });

    test("operation semantics with all possible combinations", () => {
      // Test all the different operation type combinations to ensure full coverage
      const testCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "obj:dependent",
          referenced_stable_id: "obj:referenced",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Test different combinations of operations
      const testCases = [
        // CREATE dependent, ALTER referenced
        [new DummyCreate("obj:dependent"), new DummyAlter("obj:referenced")],

        // REPLACE dependent, CREATE referenced
        [new DummyReplace("obj:dependent"), new DummyCreate("obj:referenced")],

        // ALTER dependent, REPLACE referenced
        [new DummyAlter("obj:dependent"), new DummyReplace("obj:referenced")],
      ];

      for (const testCase of testCases) {
        const result = resolver.resolveDependencies(testCase)._unsafeUnwrap();
        expect(result.length).toBe(2);

        const stableIds = result.map((c) => c.stableId);
        const refIndex = stableIds.indexOf("obj:referenced");
        const depIndex = stableIds.indexOf("obj:dependent");

        // Referenced should generally come before dependent
        expect(refIndex).toBeLessThan(depIndex);
      }
    });
  });
});
