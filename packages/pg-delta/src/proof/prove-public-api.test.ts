import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  collectTableStats,
  provePlan,
  type ProducedProofVerdict,
  type ProjectionAudit,
  type ProveOptions,
  type ProofVerdict,
  type TableStat,
} from "../index.ts";

// ProofVerdict predates projection auditing. Existing consumers must remain
// able to construct this public compatibility shape without the new field.
const legacyVerdict: ProofVerdict = {
  ok: true,
  driftDeltas: [],
  dataViolations: [],
  rewriteViolations: [],
  coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
};

describe("proof public API compatibility", () => {
  test("legacy ProofVerdict literals need no projection audit", () => {
    expect(legacyVerdict.projectionAudit).toBeUndefined();
  });

  test("provePlan returns a verdict with a required projection audit", () => {
    type Produced = Awaited<ReturnType<typeof provePlan>>;

    expectTypeOf<Produced>().toEqualTypeOf<ProducedProofVerdict>();
    expectTypeOf<
      Produced["projectionAudit"]
    >().toEqualTypeOf<ProjectionAudit>();
    expectTypeOf<Produced["projectionAuditStatus"]>().toEqualTypeOf<
      "available" | "unavailable"
    >();
    expectTypeOf<Produced["strictAuditFailure"]>().toEqualTypeOf<
      "unavailable" | "suspicious" | undefined
    >();
  });

  test("collectTableStats and TableStat are available from the package root", () => {
    expect(typeof collectTableStats).toBe("function");
    expectTypeOf<TableStat>().toMatchTypeOf<{
      rows: number;
      relfilenode: string;
      schemaSig: string;
      content?: string;
      seedable?: boolean;
    }>();
  });

  test("ProveOptions is available from the package root", () => {
    expectTypeOf<ProveOptions>().toMatchTypeOf<{
      strictAudit?: boolean;
      autoSeed?: boolean;
    }>();
    expectTypeOf<Parameters<typeof provePlan>[3]>().toEqualTypeOf<
      ProveOptions | undefined
    >();
  });
});
