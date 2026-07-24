import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  provePlan,
  type ProducedProofVerdict,
  type ProjectionAudit,
  type ProveOptions,
  type ProofVerdict,
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
