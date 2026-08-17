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
import { type LoadSqlFilesOptions } from "./index.ts";
import * as frontends from "./frontends/index.ts";
import * as integrations from "./integrations/index.ts";
import * as planSubpath from "./plan/plan.ts";
import { planSegments, segmentActions } from "./apply/apply.ts";
import { pruneStaleSqlFiles } from "./frontends/prune-sql-files.ts";
import { renderApplyScript } from "./frontends/render-apply-script.ts";
import { probeUnmodeledIdentitiesPinned } from "./frontends/schema-plan.ts";
import { hasBlockingDiagnostics } from "./frontends/diagnostics.ts";
import { dataLossActions } from "./frontends/data-loss-actions.ts";
import {
  observeDatabaseIdentity,
  databaseIdentityStamp,
  isSameDatabase,
} from "./database-identity.ts";

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

  test("root re-exports LoadSqlFilesOptions", () => {
    // Runtime: type-only re-exports have no value, so bun test cannot see
    // them except via the barrel source. Combined with `satisfies` so tsc
    // also checks the named type is the same surface.
    const src = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf-8",
    );
    expect(src).toContain("type LoadSqlFilesOptions");
    const frontendSrc = readFileSync(
      fileURLToPath(new URL("./frontends/index.ts", import.meta.url)),
      "utf-8",
    );
    expect(frontendSrc).toContain("type LoadSqlFilesOptions");

    // Named type for the loadSqlFiles third argument. Pinning
    // `strictDataStatements: true` is valid and documents the schema-first /
    // Supabase CLI adapter contract without flipping the library default.
    const options = {
      strictDataStatements: true,
    } satisfies LoadSqlFilesOptions;
    expect(options.strictDataStatements).toBe(true);
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

  test("root and ./plan re-export hazard classification helpers", () => {
    expect(typeof root.actionHazards).toBe("function");
    expect(typeof root.classifyPlanHazards).toBe("function");
    expect(typeof planSubpath.actionHazards).toBe("function");
    expect(typeof planSubpath.classifyPlanHazards).toBe("function");
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

  test("root and frontends re-export plan segment helpers", () => {
    expect(typeof root.planSegments).toBe("function");
    expect(typeof root.segmentActions).toBe("function");
    expect(root.planSegments).toBe(planSegments);
    expect(root.segmentActions).toBe(segmentActions);
    expect(typeof frontends.planSegments).toBe("function");
    expect(typeof frontends.segmentActions).toBe("function");
    expect(frontends.planSegments).toBe(planSegments);
    expect(frontends.segmentActions).toBe(segmentActions);

    const src = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf-8",
    );
    expect(src).toContain("type Segment");
    const frontendSrc = readFileSync(
      fileURLToPath(new URL("./frontends/index.ts", import.meta.url)),
      "utf-8",
    );
    expect(frontendSrc).toContain("type Segment");
  });

  test("root and frontends re-export coverage, data-loss, and database-identity helpers", () => {
    expect(typeof root.hasBlockingDiagnostics).toBe("function");
    expect(typeof frontends.hasBlockingDiagnostics).toBe("function");
    expect(root.hasBlockingDiagnostics).toBe(hasBlockingDiagnostics);
    expect(frontends.hasBlockingDiagnostics).toBe(hasBlockingDiagnostics);

    const src = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf-8",
    );
    const frontendSrc = readFileSync(
      fileURLToPath(new URL("./frontends/index.ts", import.meta.url)),
      "utf-8",
    );
    expect(src).toContain("STRICT_COVERAGE_CODES");
    expect(frontendSrc).toContain("STRICT_COVERAGE_CODES");
    expect(src).toContain("type SourceDatabaseIdentity");
    expect(frontendSrc).toContain("type SourceDatabaseIdentity");

    expect(typeof root.dataLossActions).toBe("function");
    expect(typeof frontends.dataLossActions).toBe("function");
    expect(root.dataLossActions).toBe(dataLossActions);
    expect(frontends.dataLossActions).toBe(dataLossActions);

    expect(typeof root.observeDatabaseIdentity).toBe("function");
    expect(typeof root.databaseIdentityStamp).toBe("function");
    expect(typeof root.isSameDatabase).toBe("function");
    expect(root.observeDatabaseIdentity).toBe(observeDatabaseIdentity);
    expect(root.databaseIdentityStamp).toBe(databaseIdentityStamp);
    expect(root.isSameDatabase).toBe(isSameDatabase);
    expect(typeof frontends.observeDatabaseIdentity).toBe("function");
    expect(typeof frontends.databaseIdentityStamp).toBe("function");
    expect(typeof frontends.isSameDatabase).toBe("function");
    expect(frontends.observeDatabaseIdentity).toBe(observeDatabaseIdentity);
    expect(frontends.databaseIdentityStamp).toBe(databaseIdentityStamp);
    expect(frontends.isSameDatabase).toBe(isSameDatabase);
  });

  // The build is ESM-only (package `type: module`, NodeNext output). A `require`
  // condition that points at an ESM `.js` is a lie: a CJS consumer that matches
  // it gets `ERR_REQUIRE_ESM` on Node <22. We advertise no CJS entry at all, so
  // ESM-aware tooling resolves via `import`/`default` and CJS consumers must use
  // dynamic import (or Node >=22, which can `require()` ESM synchronously).
  test("root re-exports collectTableStats", () => {
    expect(typeof root.collectTableStats).toBe("function");
  });

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
