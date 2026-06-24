/**
 * Regression: the dogfood apply-check must judge convergence through the SAME
 * profile-scoped lens used to build the plan. The dbdev core roundtrip applies
 * cleanly under `--profile supabase`, so its apply-check bucket must be a
 * converging one (not `both-fail`). Before the fix, `adjudicateApplyCheck`
 * re-extracted the post-apply state with the RAW extractor and compared it to
 * the profile-scoped desired hash, so managed `auth.*` / `storage.*` objects
 * always showed as drift and every Supabase scenario fell into `both-fail`.
 *
 * Docker required (Supabase PG15 containers + fresh clones for apply-check).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootstrapDbdevFixture,
  type DbdevFixture,
} from "../scripts/lib/bootstrap-dbdev-fixture.ts";
import { compareEngines } from "../scripts/lib/compare-core.ts";

describe("dogfood apply-check (supabase profile)", () => {
  let fixture: DbdevFixture;

  beforeAll(
    async () => {
      fixture = await bootstrapDbdevFixture("core");
    },
    5 * 60 * 1000,
  );

  afterAll(async () => {
    await fixture.cleanup();
  });

  test(
    "dbdev core roundtrip converges under the new engine",
    async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pgdelta-applycheck-"));
      const metrics = await compareEngines(
        fixture.mainPool,
        fixture.branchPool,
        {
          profile: "supabase",
          scenario: "dbdev-core-roundtrip",
          outDir,
          applyCheck: true,
        },
        fixture.mainCloneSource,
      );

      expect(metrics.new.actionCount).toBeGreaterThan(0);
      expect(metrics.applyCheck).toBeDefined();
      // the new engine's plan applies and the source matches the branch under
      // the supabase profile — managed-schema objects are out of scope.
      expect(metrics.applyCheck?.newConverges).toBe(true);
      expect(metrics.applyCheck?.bucket).not.toBe("both-fail");
    },
    5 * 60 * 1000,
  );
});
