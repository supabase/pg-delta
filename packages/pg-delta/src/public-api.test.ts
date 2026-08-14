/**
 * Public API surface guard (addresses P1 of the 2026-06-16 handoff review:
 * the safety model the docs advertise must be assemblable through STABLE
 * imports, not deep source paths).
 *
 * The headline safe path (`resolveProfile` + presets) is reachable from the
 * package root; the full profile surface (capability probing, handlers,
 * custom-profile building blocks) is reachable from the
 * `@supabase/pg-delta/integrations` subpath, which package.json declares.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import * as root from "./index.ts";
import * as frontends from "./frontends/index.ts";
import * as integrations from "./integrations/index.ts";
import * as planSubpath from "./plan/plan.ts";
import { pruneStaleSqlFiles } from "./frontends/prune-sql-files.ts";
import { renderApplyScript } from "./frontends/render-apply-script.ts";
import { probeUnmodeledIdentitiesPinned } from "./frontends/schema-plan.ts";

describe("public API surface", () => {
  test("root re-exports the headline profile API", () => {
    expect(typeof root.resolveProfile).toBe("function");
    expect(root.supabaseProfile.id).toBe("supabase");
    expect(root.rawProfile.id).toBe("raw");
  });

  test("root re-exports the export-file classification helper", () => {
    expect(typeof root.classifySqlFiles).toBe("function");
    expect(typeof root.classifySqlContent).toBe("function");
  });

  test("the integrations subpath exposes the full profile surface", () => {
    expect(typeof integrations.resolveProfile).toBe("function");
    expect(integrations.supabaseProfile.id).toBe("supabase");
    expect(integrations.rawProfile.id).toBe("raw");
    // building blocks for custom profiles + the safety helpers the docs name
    expect(typeof integrations.probeApplierCapability).toBe("function");
    expect(integrations.pgPartmanHandler.extension).toBe("pg_partman");
    expect(Array.isArray(integrations.SUPABASE_EXTENSION_HANDLERS)).toBe(true);
    expect(integrations.SUPABASE_EXTENSION_HANDLERS).toContain(
      integrations.pgPartmanHandler,
    );
  });

  test("the ./plan subpath re-exports the plan-artifact helpers the docs name", () => {
    // docs/getting-started.md imports { serializePlan, parsePlan } from
    // "@supabase/pg-delta/plan"; that subpath maps to src/plan/plan.ts, so the
    // helpers (which live in plan/artifact.ts) must be reachable there — not only
    // from the package root. A round-trip proves the re-export is the real thing.
    expect(typeof planSubpath.serializePlan).toBe("function");
    expect(typeof planSubpath.parsePlan).toBe("function");
    expect(typeof planSubpath.computePlanId).toBe("function");
    expect(typeof planSubpath.stampPlanId).toBe("function");
    expect(typeof root.computePlanId).toBe("function");
    expect(typeof root.stampPlanId).toBe("function");
  });

  test("package.json declares the ./plan subpath export", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      exports: Record<string, { bun: string; import: string; types: string }>;
    };
    const entry = pkg.exports["./plan"];
    expect(entry).toBeDefined();
    expect(entry?.bun).toBe("./src/plan/plan.ts");
    expect(entry?.import).toBe("./dist/plan/plan.js");
  });

  test("package.json declares the ./integrations subpath export", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      exports: Record<string, { bun: string; import: string; types: string }>;
    };
    // Dual conditional export: the `bun` condition serves TS source directly,
    // while `import`/`default` serve the compiled dist for Node.
    const entry = pkg.exports["./integrations"];
    expect(entry).toBeDefined();
    expect(entry?.bun).toBe("./src/integrations/index.ts");
    expect(entry?.import).toBe("./dist/integrations/index.js");
    expect(entry?.types).toBe("./dist/integrations/index.d.ts");
  });

  test("root and frontends re-export schema-first CLI helpers", () => {
    expect(typeof root.pruneStaleSqlFiles).toBe("function");
    expect(typeof root.renderApplyScript).toBe("function");
    expect(typeof root.probeUnmodeledIdentitiesPinned).toBe("function");
    expect(root.pruneStaleSqlFiles).toBe(pruneStaleSqlFiles);
    expect(root.renderApplyScript).toBe(renderApplyScript);
    expect(root.probeUnmodeledIdentitiesPinned).toBe(
      probeUnmodeledIdentitiesPinned,
    );
    expect(typeof frontends.pruneStaleSqlFiles).toBe("function");
    expect(typeof frontends.renderApplyScript).toBe("function");
    expect(typeof frontends.probeUnmodeledIdentitiesPinned).toBe("function");
    expect(frontends.pruneStaleSqlFiles).toBe(pruneStaleSqlFiles);
    expect(frontends.renderApplyScript).toBe(renderApplyScript);
    expect(frontends.probeUnmodeledIdentitiesPinned).toBe(
      probeUnmodeledIdentitiesPinned,
    );
  });

  // The build is ESM-only (package `type: module`, NodeNext output). A `require`
  // condition that points at an ESM `.js` is a lie: a CJS consumer that matches
  // it gets `ERR_REQUIRE_ESM` on Node <22. We advertise no CJS entry at all, so
  // ESM-aware tooling resolves via `import`/`default` and CJS consumers must use
  // dynamic import (or Node >=22, which can `require()` ESM synchronously).
  test("no export entry advertises a `require` condition (ESM-only package)", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      exports: Record<string, Record<string, string>>;
    };
    const offenders = Object.entries(pkg.exports)
      .filter(([, conditions]) => "require" in conditions)
      .map(([subpath]) => subpath);
    expect(offenders).toEqual([]);
  });
});
