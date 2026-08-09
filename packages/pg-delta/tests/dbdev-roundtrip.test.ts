/**
 * Integration test: dbdev core schema roundtrip under the Supabase profile.
 *
 * Mirrors packages/pg-delta/tests/integration/dbdev-roundtrip.test.ts for the
 * new engine: plan main (Supabase base-init only) → branch (base-init + dbdev
 * core migrations), apply on main, assert zero drift under supabasePolicy.
 *
 * Managed-schema objects (auth.*, storage.*) are intentionally excluded from
 * the plan; convergence is checked via a profile-scoped re-plan, not raw diff.
 *
 * Docker required (two Supabase PG15 containers + dbdev fixture migrations).
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { resolveCliProfile } from "../src/cli/profile.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { bootstrapDbdevFixture } from "../scripts/lib/bootstrap-dbdev-fixture.ts";
import { runSupabaseBareTests } from "./containers.ts";

// Heavy Supabase-image test: boots two supabase/postgres containers. Gated like
// the other Supabase-image suites so it runs only on the matching PG leg (or
// with PGDELTA_NEXT_SUPABASE_TESTS=1), not on all CI legs.
describe.skipIf(!runSupabaseBareTests)(
  "dbdev core roundtrip (supabase profile)",
  () => {
    test(
      "supabase-profile plan applies on main and converges to branch state",
      async () => {
        const fixture = await bootstrapDbdevFixture("core");

        try {
          const ctx = await resolveCliProfile(fixture.mainPool, "supabase", {
            restrictToApplier: false,
          });
          const extractFn = ctx.extract ?? extract;

          const [sourceState, desiredState] = await Promise.all([
            extractFn(fixture.mainPool),
            extractFn(fixture.branchPool),
          ]);

          const thePlan = plan(sourceState.factBase, desiredState.factBase, {
            compact: true,
            ...ctx.planOptions,
          });
          expect(thePlan.actions.length).toBeGreaterThan(0);

          const report = await apply(thePlan, fixture.mainPool, {
            fingerprintGate: false,
            ...ctx.applyOptions,
          });
          if (report.status !== "applied") {
            const action = report.error;
            throw new Error(
              `apply failed at action ${action?.actionIndex ?? "?"}: ${action?.message ?? report.status}\nSQL: ${action?.sql ?? "(none)"}`,
            );
          }

          const afterApply = await extractFn(fixture.mainPool);
          const driftPlan = plan(
            afterApply.factBase,
            desiredState.factBase,
            ctx.planOptions,
          );
          if (driftPlan.actions.length > 0) {
            const driftSql = driftPlan.actions.map((a) => a.sql).join("\n\n");
            throw new Error(
              `${driftPlan.actions.length} drift action(s) after apply:\n${driftSql}`,
            );
          }

          expect(driftPlan.actions).toEqual([]);
        } finally {
          await fixture.cleanup();
        }
      },
      5 * 60 * 1000,
    );
  },
);
