import { describe, expect, test } from "bun:test";
import { Cluster } from "./containers.ts";

function clusterWithRoleCleanupFailure(): Cluster {
  const adminPool = {
    async query(sql: string) {
      if (sql.startsWith("SELECT rolname")) {
        return { rows: [{ rolname: "test" }, { rolname: "leftover" }] };
      }
      if (sql.startsWith("DROP ")) {
        throw new Error("role is still referenced");
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  return new Cluster(undefined as never, adminPool as never, () => "");
}

describe("Cluster.dropRolesExcept", () => {
  test("strict cleanup rejects when a non-baseline role remains", async () => {
    const cluster = clusterWithRoleCleanupFailure();

    expect(
      cluster.dropRolesExcept(new Set(["test"]), { strict: true }),
    ).rejects.toThrow(/role cleanup incomplete.*leftover/i);
  });
});
