import { describe, expect, test } from "vitest";
import { CompositeType } from "../composite-type.model.ts";
import {
  AlterCompositeTypeChangeOwner,
  ReplaceCompositeType,
} from "./composite-type.alter.ts";

describe.concurrent("composite-type", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new CompositeType({
        schema: "public",
        name: "test_type",
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
      const branch = new CompositeType({
        schema: "public",
        name: "test_type",
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

      const change = new AlterCompositeTypeChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_type OWNER TO new_owner",
      );
    });

    test("replace composite type", () => {
      const main = new CompositeType({
        schema: "public",
        name: "test_type",
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
      const branch = new CompositeType({
        schema: "public",
        name: "test_type",
        row_security: true,
        force_row_security: true,
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

      const change = new ReplaceCompositeType({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP TYPE public.test_type;\nCREATE TYPE public . test_type AS ()",
      );
    });
  });
});
