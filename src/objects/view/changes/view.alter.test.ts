import { describe, expect, test } from "vitest";
import { View, type ViewProps } from "../view.model.ts";
import { AlterViewChangeOwner, ReplaceView } from "./view.alter.ts";

describe.concurrent("view", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<ViewProps, "owner"> = {
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
      };
      const main = new View({
        ...props,
        owner: "old_owner",
      });
      const branch = new View({
        ...props,
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
      const props: Omit<ViewProps, "definition"> = {
        schema: "public",
        name: "test_view",
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
      };
      const main = new View({
        ...props,
        definition: "SELECT * FROM test_table",
      });
      const branch = new View({
        ...props,
        definition: "SELECT id, name FROM test_table",
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
