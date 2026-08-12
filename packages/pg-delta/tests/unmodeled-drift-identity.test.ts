/**
 * `unmodeled_drift` compares IDENTITIES, not bare catalog names
 * (docs/architecture/custom-folder.md §7).
 *
 * The drift guard exists because unmodeled objects produce no facts: an object
 * the shadow has and the target lacks is a prerequisite no planned statement can
 * create. That guard is a set-diff, so it is only as good as the identity it
 * diffs. A bare `cfgname` / `oprname` makes two DIFFERENT objects compare equal
 * — a text search configuration in another schema, or an operator of the same
 * name over different operand types — and the diagnostic then misses exactly
 * the case it was built to catch.
 *
 * Real catalogs are the only credible test here (the identity is SQL the server
 * evaluates), so this runs against a live PostgreSQL. Docker required.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import {
  detectUnmodeledDrift,
  probeUnmodeledIdentities,
} from "../src/extract/unmodeled.ts";
import { probeUnmodeledIdentitiesPinned } from "../src/frontends/schema-plan.ts";
import { createTestDb } from "./containers.ts";

const PG_MAJOR = Number(
  /postgres:(\d+)/.exec(
    process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
  )?.[1] ?? "17",
);

/** Both sides get `a.cfg` and `public.### (int, int)`; only the shadow also gets
 *  the same-named-but-different `b.cfg` and `public.### (text, text)`. So one
 *  fixture proves both halves of the contract: matching identities are NOT
 *  drift, and same-name/different-identity IS. */
const SHARED_DDL = /* sql */ `
  CREATE SCHEMA a;
  CREATE TEXT SEARCH CONFIGURATION a.cfg (COPY = pg_catalog.english);
  CREATE FUNCTION public.eq_int(integer, integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS 'SELECT $1 = $2';
  CREATE OPERATOR public.### (
    leftarg = integer, rightarg = integer, function = public.eq_int);
`;

const SHADOW_ONLY_DDL = /* sql */ `
  CREATE SCHEMA b;
  CREATE TEXT SEARCH CONFIGURATION b.cfg (COPY = pg_catalog.english);
  CREATE FUNCTION public.eq_text(text, text) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS 'SELECT $1 = $2';
  CREATE OPERATOR public.### (
    leftarg = text, rightarg = text, function = public.eq_text);
`;

describe("unmodeled drift is diffed on qualified identities", () => {
  test("same name, different schema / operand types is drift; a true match is not", async () => {
    const shadow = await createTestDb("drift_ident_shadow");
    const target = await createTestDb("drift_ident_target");
    try {
      await shadow.pool.query(SHARED_DDL);
      await shadow.pool.query(SHADOW_ONLY_DDL);
      await target.pool.query(SHARED_DDL);

      const drift = detectUnmodeledDrift(
        await probeUnmodeledIdentities(shadow.pool, PG_MAJOR),
        await probeUnmodeledIdentities(target.pool, PG_MAJOR),
      );

      // the schema is part of a text search configuration's identity: `b.cfg`
      // is missing on the target even though a `cfg` by that bare name exists
      const cfg = drift.find(
        (d) => d.context?.["kind"] === "text search configuration",
      );
      expect(cfg).toBeDefined();
      const cfgMissing = (cfg?.context?.["missing"] ?? []) as string[];
      expect(cfgMissing).toHaveLength(1); // a.cfg matched, b.cfg did not
      expect(cfgMissing[0]).toContain("b");
      expect(cfgMissing[0]).toContain("cfg");
      expect(cfg?.message).toContain("cfg");

      // operand types are part of an operator's identity: the text/text `###`
      // is missing even though an `###` by that bare name exists
      const operator = drift.find((d) => d.context?.["kind"] === "operator");
      expect(operator).toBeDefined();
      const operatorMissing = (operator?.context?.["missing"] ??
        []) as string[];
      expect(operatorMissing).toHaveLength(1); // int/int matched, text/text did not
      expect(operatorMissing[0]).toContain("###");
      expect(operatorMissing[0]).toContain("text");
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 180_000);
});

describe("the drift probe runs under the SAME canonical search_path extraction uses", () => {
  test("a user relation shadowing an unqualified catalog table (app.pg_cast) breaks the unpinned probe; the pinned call-site wrapper is unaffected", async () => {
    const target = await createTestDb("drift_pin_target");
    let freshPool: pg.Pool | undefined;
    try {
      // A legitimate unmodeled object, so a passing result has teeth: it must
      // still be reported correctly under the polluted search_path, not just
      // "did not throw".
      await target.pool.query(
        `CREATE TEXT SEARCH CONFIGURATION public.custom_cfg (COPY = pg_catalog.english);
         CREATE SCHEMA app;
         CREATE TABLE app.pg_cast(id int);`,
      );
      // `search_path = app, pg_catalog` EXPLICITLY lists pg_catalog, so it is
      // searched in the stated order (app first) rather than implicitly
      // first — new connections pick this up, existing pooled ones do not, so
      // a fresh pool is required.
      await target.cluster.adminPool.query(
        `ALTER DATABASE "${target.name}" SET search_path TO app, pg_catalog`,
      );
      freshPool = new pg.Pool({ connectionString: target.uri, max: 1 });
      freshPool.on("error", () => {});

      // RED: the unpinned probe resolves `pg_cast` against `app.pg_cast`
      // (wrong columns) instead of the catalog table, and errors.
      expect(probeUnmodeledIdentities(freshPool, PG_MAJOR)).rejects.toThrow();

      // GREEN: the call-site wrapper pins `search_path TO pg_catalog` for the
      // probe's transaction, so it resolves the real catalog and reports the
      // genuine unmodeled object correctly despite the shadowing table.
      const pinned = await probeUnmodeledIdentitiesPinned(freshPool, PG_MAJOR);
      expect(pinned.get("text search configuration")).toEqual([
        "public.custom_cfg",
      ]);
      expect(pinned.has("cast")).toBe(false);
    } finally {
      await freshPool?.end().catch(() => {});
      await target.drop();
    }
  }, 180_000);
});
