import { describe, expect, test } from "vitest";
import {
  CompositeType,
  type CompositeTypeProps,
} from "../composite-type.model.ts";
import {
  AlterCompositeTypeChangeOwner,
  ReplaceCompositeType,
} from "./composite-type.alter.ts";

describe.concurrent("composite-type", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<CompositeTypeProps, "owner"> = {
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
      };
      const main = new CompositeType({
        ...props,
        owner: "old_owner",
      });
      const branch = new CompositeType({
        ...props,
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
      const props: Omit<
        CompositeTypeProps,
        "row_security" | "force_row_security"
      > = {
        schema: "public",
        name: "test_type",
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
      const main = new CompositeType({
        ...props,
        row_security: false,
        force_row_security: false,
      });
      const branch = new CompositeType({
        ...props,
        row_security: true,
        force_row_security: true,
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
