/**
 * Unit tests for CLI profile selection (src/cli/profile.ts). No DB.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawProfile } from "../integrations/profile.ts";
import { supabaseProfile } from "../integrations/supabase.ts";
import { UsageError } from "./flags.ts";
import {
  effectiveProfileId,
  isProfilePath,
  parseProfileFile,
  profileById,
} from "./profile.ts";

function writeTempProfile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-profile-"));
  const path = join(dir, "profile.json");
  writeFileSync(path, contents, "utf8");
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
