/**
 * Unit tests for CLI profile selection (src/cli/profile.ts). No DB.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFactBase } from "../core/fact.ts";
import { serializeSnapshot } from "../core/snapshot.ts";
import { rawProfile } from "../integrations/profile.ts";
import { supabaseProfile } from "../integrations/supabase.ts";
import { UsageError } from "./flags.ts";
import {
  effectiveProfileId,
  isProfilePath,
  parseProfileFile,
  profileById,
  reconcileBaselineDigest,
} from "./profile.ts";

function writeTempProfile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-profile-"));
  const path = join(dir, "profile.json");
  writeFileSync(path, contents, "utf8");
  return path;
}

function writeTempSnapshot(fb: ReturnType<typeof buildFactBase>): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-baseline-"));
  const path = join(dir, "snapshot.json");
  writeFileSync(path, serializeSnapshot(fb, { pgVersion: "170000" }), "utf8");
  return path;
}

describe("profileById", () => {
  test("defaults to the raw profile when no id is given", () => {
    expect(profileById(undefined)).toBe(rawProfile);
    expect(profileById("raw")).toBe(rawProfile);
  });

  test("maps 'supabase' to the Supabase profile", () => {
    expect(profileById("supabase")).toBe(supabaseProfile);
  });

  test("rejects an unknown profile id with a UsageError", () => {
    expect(() => profileById("bogus")).toThrow(UsageError);
    expect(() => profileById("bogus")).toThrow(/--profile must be one of/);
  });
});

describe("effectiveProfileId (apply/prove: flag vs plan-stamped profile)", () => {
  test("uses the flag when given", () => {
    expect(effectiveProfileId("supabase", undefined)).toBe("supabase");
    expect(effectiveProfileId("raw", "raw")).toBe("raw");
  });

  test("defaults to the plan's stamped profile when the flag is omitted", () => {
    expect(effectiveProfileId(undefined, "supabase")).toBe("supabase");
  });

  test("profile-less plan (library plan()) + no flag → undefined (resolves to raw)", () => {
    expect(effectiveProfileId(undefined, undefined)).toBeUndefined();
  });

  test("rejects a flag that contradicts the plan's stamped profile", () => {
    expect(() => effectiveProfileId("raw", "supabase")).toThrow(UsageError);
    expect(() => effectiveProfileId("raw", "supabase")).toThrow(
      /does not match the plan's profile/,
    );
  });

  test("a file-path flag reconciles against the file's declared id", () => {
    const path = writeTempProfile(
      JSON.stringify({ id: "platform-middleware", handlers: ["pg_partman"] }),
    );
    // flag is the PATH, plan stamped the file's declared id → they agree
    expect(effectiveProfileId(path, "platform-middleware")).toBe(path);
    // a contradicting stamped id is rejected
    expect(() => effectiveProfileId(path, "supabase")).toThrow(
      /does not match/,
    );
  });
});

describe("isProfilePath", () => {
  test("treats a value with a slash or a .json suffix as a path", () => {
    expect(isProfilePath("./p.json")).toBe(true);
    expect(isProfilePath("dir/p")).toBe(true);
    expect(isProfilePath("profile.json")).toBe(true);
    expect(isProfilePath("supabase")).toBe(false);
    expect(isProfilePath("raw")).toBe(false);
  });
});

describe("parseProfileFile (custom file-based profiles)", () => {
  test("resolves handler names against the bundled registry", () => {
    const profile = parseProfileFile(
      JSON.stringify({
        id: "platform-middleware",
        handlers: ["pg_partman", "pg_cron"],
      }),
      "profile.json",
    );
    expect(profile.id).toBe("platform-middleware");
    expect(profile.handlers.map((h) => h.extension)).toEqual([
      "pg_partman",
      "pg_cron",
    ]);
    expect(profile.policy).toBeUndefined();
  });

  test("passes a declared policy through", () => {
    const profile = parseProfileFile(
      JSON.stringify({
        id: "p",
        handlers: [],
        policy: { id: "pol", filter: [] },
      }),
      "profile.json",
    );
    expect(profile.policy?.id).toBe("pol");
  });

  test("rejects an unknown handler name with a UsageError listing valid names", () => {
    expect(() =>
      parseProfileFile(
        JSON.stringify({ id: "p", handlers: ["pg_bogus"] }),
        "profile.json",
      ),
    ).toThrow(UsageError);
    expect(() =>
      parseProfileFile(
        JSON.stringify({ id: "p", handlers: ["pg_bogus"] }),
        "profile.json",
      ),
    ).toThrow(/unknown handler 'pg_bogus'/);
  });

  test("rejects a missing id / non-array handlers / bad JSON", () => {
    expect(() =>
      parseProfileFile(JSON.stringify({ handlers: [] }), "p.json"),
    ).toThrow(/id/);
    expect(() =>
      parseProfileFile(JSON.stringify({ id: "p", handlers: "nope" }), "p.json"),
    ).toThrow(/handlers/);
    expect(() => parseProfileFile("{not json", "p.json")).toThrow();
  });
});

describe("profileById with a file path", () => {
  test("loads a profile from a .json path", () => {
    const path = writeTempProfile(
      JSON.stringify({ id: "platform-middleware", handlers: ["pg_cron"] }),
    );
    const profile = profileById(path);
    expect(profile.id).toBe("platform-middleware");
    expect(profile.handlers.map((h) => h.extension)).toEqual(["pg_cron"]);
  });
});

describe("parseProfileFile: baseline field", () => {
  test("resolves a relative baseline path against the profile file's directory", () => {
    const profile = parseProfileFile(
      JSON.stringify({
        id: "mw",
        handlers: [],
        baseline: "./middleware-base.json",
      }),
      "/proj/db/pgdelta-profile.json",
      { dir: "/proj/db" },
    );
    expect(profile.baselinePath).toBe("/proj/db/middleware-base.json");
  });

  test("keeps an absolute baseline path as-is; omits when absent", () => {
    expect(
      parseProfileFile(
        JSON.stringify({ id: "a", handlers: [], baseline: "/abs/base.json" }),
        "p.json",
        { dir: "/proj" },
      ).baselinePath,
    ).toBe("/abs/base.json");
    expect(
      parseProfileFile(JSON.stringify({ id: "b", handlers: [] }), "p.json")
        .baselinePath,
    ).toBeUndefined();
  });

  test("rejects a non-string / empty baseline", () => {
    expect(() =>
      parseProfileFile(
        JSON.stringify({ id: "a", handlers: [], baseline: 5 }),
        "p.json",
      ),
    ).toThrow(/"baseline" must be a non-empty string/);
    expect(() =>
      parseProfileFile(
        JSON.stringify({ id: "a", handlers: [], baseline: "" }),
        "p.json",
      ),
    ).toThrow(/"baseline" must be a non-empty string/);
  });

  test("a profile .json with a relative baseline loads with an absolute baselinePath", () => {
    const fb = buildFactBase(
      [{ id: { kind: "schema", name: "platform" }, payload: {} }],
      [],
    );
    const snapPath = writeTempSnapshot(fb);
    const dir = mkdtempSync(join(tmpdir(), "pgdelta-profile-baseline-"));
    const profilePath = join(dir, "profile.json");
    // reference the snapshot by a path relative to the profile file's dir
    writeFileSync(
      profilePath,
      JSON.stringify({ id: "mw", handlers: [], baseline: snapPath }),
      "utf8",
    );
    expect(profileById(profilePath).baselinePath).toBe(snapPath);
  });
});

describe("reconcileBaselineDigest", () => {
  test("passes when the digests match (or both absent)", () => {
    expect(() =>
      reconcileBaselineDigest("abc", "abc", "plan artifact"),
    ).not.toThrow();
    expect(() =>
      reconcileBaselineDigest(undefined, undefined, "plan artifact"),
    ).not.toThrow();
  });

  test("throws on every asymmetry (mismatch / stamped-only / resolved-only)", () => {
    expect(() =>
      reconcileBaselineDigest("aaaa", "bbbb", "plan artifact"),
    ).toThrow(UsageError);
    expect(() =>
      reconcileBaselineDigest("aaaa", undefined, "export manifest"),
    ).toThrow(/declares NO baseline/);
    expect(() =>
      reconcileBaselineDigest(undefined, "bbbb", "export manifest"),
    ).toThrow(/was produced with NONE/);
  });
});
