/**
 * Default-privilege rendering, incl. the "revoked built-in default" marker
 * (empty `privileges` + `_revokedDefault`) that lets an
 * `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` round-trip:
 * CREATE emits the REVOKE, DROP restores the default with a GRANT.
 */
import { describe, expect, test } from "bun:test";
import type { Fact } from "../../core/fact.ts";
import {
  defaultPrivilegeCreateActions,
  defaultPrivilegeDropActions,
} from "./helpers.ts";

const marker: Fact = {
  id: {
    kind: "defaultPrivilege",
    role: "owner",
    schema: null,
    objtype: "f",
    grantee: "PUBLIC",
  },
  payload: { privileges: [], grantable: [], _revokedDefault: ["EXECUTE"] },
};

const grant: Fact = {
  id: {
    kind: "defaultPrivilege",
    role: "owner",
    schema: "app",
    objtype: "r",
    grantee: "reader",
  },
  payload: { privileges: ["SELECT"], grantable: [] },
};

describe("default-privilege rendering", () => {
  test("revoked-default marker: CREATE revokes, DROP restores via GRANT", () => {
    expect(defaultPrivilegeCreateActions(marker).map((a) => a.sql)).toEqual([
      `ALTER DEFAULT PRIVILEGES FOR ROLE "owner" REVOKE ALL ON FUNCTIONS FROM PUBLIC`,
    ]);
    expect(defaultPrivilegeDropActions(marker).sql).toBe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "owner" GRANT EXECUTE ON FUNCTIONS TO PUBLIC`,
    );
  });

  test("positive grant: CREATE grants, DROP revokes", () => {
    expect(defaultPrivilegeCreateActions(grant).map((a) => a.sql)).toEqual([
      `ALTER DEFAULT PRIVILEGES FOR ROLE "owner" IN SCHEMA "app" GRANT SELECT ON TABLES TO "reader"`,
    ]);
    expect(defaultPrivilegeDropActions(grant).sql).toBe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "owner" IN SCHEMA "app" REVOKE ALL ON TABLES FROM "reader"`,
    );
  });
});
