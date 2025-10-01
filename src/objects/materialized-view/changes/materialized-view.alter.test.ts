import { describe, expect, test } from "vitest";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "../materialized-view.model.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
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
        comment: null,
        columns: [],
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

    test("set storage params", () => {
      const props: Omit<MaterializedViewProps, "options"> = {
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
        partition_bound: null,
        owner: "test",
        comment: null,
        columns: [],
      };
      const main = new MaterializedView({
        ...props,
        options: [],
      });
      const branch = new MaterializedView({
        ...props,
        options: ["fillfactor=90"],
      });

      const change = new AlterMaterializedViewSetStorageParams({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90)",
      );
    });

    test("reset and set storage params", () => {
      const props: Omit<MaterializedViewProps, "options"> = {
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
        partition_bound: null,
        owner: "test",
        comment: null,
        columns: [],
      };
      const main = new MaterializedView({
        ...props,
        options: ["fillfactor=70", "autovacuum_enabled=false"],
      });
      const branch = new MaterializedView({
        ...props,
        options: ["fillfactor=90", "user_catalog_table=true"],
      });

      const change = new AlterMaterializedViewSetStorageParams({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        [
          "ALTER MATERIALIZED VIEW public.test_mv RESET (autovacuum_enabled)",
          "ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90, user_catalog_table=true)",
        ].join(";\n"),
      );
    });
  });
});
