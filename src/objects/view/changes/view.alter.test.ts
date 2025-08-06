import { describe, expect, test } from "vitest";
import { View } from "../view.model.ts";
import { AlterViewChangeOwner, ReplaceView } from "./view.alter.ts";

describe.concurrent("view", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new View({
        schema: "public",
        name: "test_view",
        definition: "SELECT * FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "old_owner",
      });
      const branch = new View({
        schema: "public",
        name: "test_view",
        definition: "SELECT * FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "new_owner",
      });

      const change = new AlterViewChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER VIEW public.test_view OWNER TO new_owner",
      );
    });

    test("replace view", () => {
      const main = new View({
        schema: "public",
        name: "test_view",
        definition: "SELECT * FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "test",
      });
      const branch = new View({
        schema: "public",
        name: "test_view",
        definition: "SELECT id, name FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "test",
      });

      const change = new ReplaceView({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP VIEW public.test_view;\nCREATE OR REPLACE VIEW public.test_view AS SELECT id, name FROM test_table",
      );
    });
  });
});
