import { describe, expect, test } from "vitest";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "../materialized-view.model.ts";
import {
  AlterMaterializedViewChangeOwner,
  ReplaceMaterializedView,
} from "./materialized-view.alter.ts";

describe.concurrent("materialized-view", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<MaterializedViewProps, "owner"> = {
        schema: "public",
        name: "test_mv",
        definition: "SELECT * FROM test_table",
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
      };
      const main = new MaterializedView({
        ...props,
        owner: "old_owner",
      });
      const branch = new MaterializedView({
        ...props,
        owner: "new_owner",
      });

      const change = new AlterMaterializedViewChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER MATERIALIZED VIEW public.test_mv OWNER TO new_owner",
      );
    });

    test("replace materialized view", () => {
      const props: Omit<MaterializedViewProps, "definition"> = {
        schema: "public",
        name: "test_mv",
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
        owner: "test",
      };
      const main = new MaterializedView({
        ...props,
        definition: "SELECT * FROM test_table",
      });
      const branch = new MaterializedView({
        ...props,
        definition: "SELECT id, name FROM test_table",
      });

      const change = new ReplaceMaterializedView({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP MATERIALIZED VIEW public.test_mv;\nCREATE MATERIALIZED VIEW public.test_mv AS SELECT id, name FROM test_table WITH DATA",
      );
    });
  });
});
