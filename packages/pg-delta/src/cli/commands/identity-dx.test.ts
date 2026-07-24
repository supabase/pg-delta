import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { formatPlanIdentityWarning } from "./plan.ts";
import { observeExplicitShadowIdentities } from "./schema.ts";

const identityRow = {
  database: "db",
  databaseOid: "16384",
  systemIdentifier: "7612345678901234567",
};

function poolWith(result: "ok" | "denied"): {
  pool: Pool;
  calls: () => number;
} {
  let count = 0;
  return {
    pool: {
      query: async () => {
        count++;
        if (result === "denied") {
          throw Object.assign(new Error("permission denied"), { code: "42501" });
        }
        return { rows: [identityRow] };
      },
    } as unknown as Pool,
    calls: () => count,
  };
}

describe("identity safety DX", () => {
  test("plan warning says permission must be granted before re-planning", () => {
    const warning = formatPlanIdentityWarning();
    expect(warning).toContain("grant");
    expect(warning).toMatch(/re-plan|run .*plan again/i);
    expect(warning).toContain("--allow-unverified-source-identity");
  });

  test("explicit shadow probes identify a target-side denial deterministically", async () => {
    const target = poolWith("denied");
    const shadow = poolWith("ok");

    expect(
      observeExplicitShadowIdentities(target.pool, shadow.pool),
    ).rejects.toThrow(/target safety.*GRANT EXECUTE/is);
    expect(target.calls()).toBe(1);
    expect(shadow.calls()).toBe(0);
  });

  test("explicit shadow probes identify a shadow-side denial deterministically", async () => {
    const target = poolWith("ok");
    const shadow = poolWith("denied");

    expect(
      observeExplicitShadowIdentities(target.pool, shadow.pool),
    ).rejects.toThrow(/shadow safety.*GRANT EXECUTE/is);
    expect(target.calls()).toBe(1);
    expect(shadow.calls()).toBe(1);
  });
});
