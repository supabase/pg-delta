import { describe, expect, test } from "vitest";
import { View, type ViewProps } from "../view.model.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
  ReplaceView,
} from "./view.alter.ts";

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
        "DROP VIEW public.test_view;\nCREATE VIEW public.test_view AS SELECT id, name FROM test_table",
      );
    });
  });

  test("set options", () => {
    const props: Omit<ViewProps, "options"> = {
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
      partition_bound: null,
      owner: "test",
    };
    const main = new View({ ...props, options: ["security_barrier=true"] });
    const branch = new View({ ...props, options: ["security_barrier=false"] });

    const change = new AlterViewSetOptions({ main, branch });
    expect(change.serialize()).toBe(
      "ALTER VIEW public.test_view SET (security_barrier=false)",
    );
  });

  test("reset options", () => {
    const view = new View({
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
      options: ["security_barrier=true", "check_option=local"],
      partition_bound: null,
      owner: "test",
    });

    const change = new AlterViewResetOptions({
      view,
      params: ["check_option"],
    });
    expect(change.serialize()).toBe(
      "ALTER VIEW public.test_view RESET (check_option)",
    );
  });
});
