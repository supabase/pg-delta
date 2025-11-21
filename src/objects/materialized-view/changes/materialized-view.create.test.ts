import { describe, expect, test } from "vitest";
import { MaterializedView } from "../materialized-view.model.ts";
import { CreateMaterializedView } from "./materialized-view.create.ts";

describe("materialized-view", () => {
  test("create minimal", () => {
    const mv = new MaterializedView({
      schema: "public",
      name: "test_mv",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      // Default is WITH NO DATA -> omitted
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "test",
      columns: [],
      comment: null,
      privileges: [],
    });

    const change = new CreateMaterializedView({ materializedView: mv });

    expect(change.serialize()).toBe(
      "CREATE MATERIALIZED VIEW public.test_mv AS SELECT * FROM test_table WITH NO DATA",
    );
  });

  test("create with all options", () => {
    const mv = new MaterializedView({
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
      options: ["fillfactor=90", "autovacuum_enabled=false"],
      partition_bound: null,
      owner: "test",
      columns: [],
      comment: null,
      privileges: [],
    });

    const change = new CreateMaterializedView({ materializedView: mv });

    expect(change.serialize()).toBe(
      "CREATE MATERIALIZED VIEW public.test_mv WITH (fillfactor=90, autovacuum_enabled=false) AS SELECT * FROM test_table WITH DATA",
    );
  });
});
