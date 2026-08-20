import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../core/diagnostic.ts";
import {
  filterPlatformParameterAclDiagnostics,
  userOwnedParameterAclNames,
} from "./parameter-acl.ts";

const platformOnly = [
  {
    name: "log_min_messages",
    grantee: "supabase_admin",
    privilege: "ALTER SYSTEM",
  },
  { name: "log_min_messages", grantee: "supabase_admin", privilege: "SET" },
  {
    name: "log_min_messages",
    grantee: "supabase_realtime_admin",
    privilege: "SET",
  },
] as const;

const parameterAclDiagnostic: Diagnostic = {
  code: "unmodeled_kind",
  severity: "warning",
  message:
    '1 unmodeled "parameter ACL" object not managed by this engine (e.g. log_min_messages) — v1 detects but does not model this kind; this kind lives in a catalog shared by every database in the cluster',
  context: { kind: "parameter ACL", count: 1, samples: ["log_min_messages"] },
};

describe("userOwnedParameterAclNames", () => {
  test("platform triples alone yield no user names", () => {
    expect(userOwnedParameterAclNames(platformOnly)).toEqual([]);
  });

  test("a user grant on another GUC is kept", () => {
    expect(
      userOwnedParameterAclNames([
        ...platformOnly,
        { name: "work_mem", grantee: "app", privilege: "SET" },
      ]),
    ).toEqual(["work_mem"]);
  });

  test("a user grant on log_min_messages is kept", () => {
    expect(
      userOwnedParameterAclNames([
        ...platformOnly,
        { name: "log_min_messages", grantee: "app", privilege: "SET" },
      ]),
    ).toEqual(["log_min_messages"]);
  });
});

describe("filterPlatformParameterAclDiagnostics", () => {
  test("drops the diagnostic when only platform grants remain", () => {
    expect(
      filterPlatformParameterAclDiagnostics([parameterAclDiagnostic], []),
    ).toEqual([]);
  });

  test("rewrites samples to user-owned GUC names", () => {
    const [next] = filterPlatformParameterAclDiagnostics(
      [parameterAclDiagnostic],
      ["work_mem"],
    );
    expect(next?.context).toEqual({
      kind: "parameter ACL",
      count: 1,
      samples: ["work_mem"],
    });
    expect(next?.message).toContain("work_mem");
    expect(next?.message).not.toContain("e.g. log_min_messages)");
    expect(next?.message).toContain("cluster");
  });

  test("leaves unrelated diagnostics intact", () => {
    const other: Diagnostic = {
      code: "unmodeled_kind",
      severity: "warning",
      message: "cast",
      context: { kind: "cast", count: 1, samples: ["x"] },
    };
    expect(filterPlatformParameterAclDiagnostics([other], [])).toEqual([other]);
  });
});
