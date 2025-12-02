/**
 * Integration test to verify that CREATE ROLE and CREATE SCHEMA statements
 * are correctly ordered before ALTER DEFAULT PRIVILEGES statements that depend on them.
 */

import { describe } from "vitest";
import type { Change } from "../../src/core/change.types.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../../src/core/objects/role/changes/role.privilege.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { roundtripFidelityTest } from "../integration/roundtrip.ts";
import { getTestIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`default privileges dependency ordering (pg${pgVersion})`, () => {
    test("CREATE ROLE must come before ALTER DEFAULT PRIVILEGES FOR ROLE", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Empty initial setup
        `,
        testSql: `
          -- Create a new role
          CREATE ROLE app_user;
          
          -- Set default privileges for that role
          ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public 
            GRANT SELECT ON TABLES TO app_user;
        `,
        sortChangesCallback: (a, b) => {
          // Force ALTER DEFAULT PRIVILEGES before CREATE ROLE to ensure dependency sorting fixes the order
          const priority = (change: Change) => {
            if (
              change instanceof GrantRoleDefaultPrivileges ||
              change instanceof RevokeRoleDefaultPrivileges
            ) {
              return 0; // ALTER DEFAULT PRIVILEGES first (wrong order)
            }
            if (
              change.objectType === "role" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
              return 1; // CREATE ROLE second (wrong order)
            }
            return 2;
          };

          return priority(a) - priority(b);
        },
      });
    });

    test("CREATE SCHEMA must come before ALTER DEFAULT PRIVILEGES IN SCHEMA", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create a role that will be used
          CREATE ROLE app_user;
        `,
        testSql: `
          -- Create a new schema
          CREATE SCHEMA app;
          
          -- Set default privileges in that schema
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app 
            GRANT ALL ON TABLES TO app_user;
        `,
        sortChangesCallback: (a, b) => {
          // Force ALTER DEFAULT PRIVILEGES before CREATE SCHEMA to ensure dependency sorting fixes the order
          const priority = (change: Change) => {
            if (
              change instanceof GrantRoleDefaultPrivileges ||
              change instanceof RevokeRoleDefaultPrivileges
            ) {
              return 0; // ALTER DEFAULT PRIVILEGES first (wrong order)
            }
            if (
              change.objectType === "schema" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
              return 1; // CREATE SCHEMA second (wrong order)
            }
            return 2;
          };

          return priority(a) - priority(b);
        },
      });
    });

    test("CREATE ROLE and CREATE SCHEMA must come before ALTER DEFAULT PRIVILEGES", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Empty initial setup
        `,
        testSql: `
          -- Create a new role
          CREATE ROLE app_user;
          
          -- Create a new schema
          CREATE SCHEMA app;
          
          -- Set default privileges for that role in that schema
          ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA app 
            GRANT ALL ON TABLES TO app_user;
        `,
        sortChangesCallback: (a, b) => {
          // Force ALTER DEFAULT PRIVILEGES before CREATE ROLE and CREATE SCHEMA
          // to ensure dependency sorting fixes the order
          const priority = (change: Change) => {
            if (
              change instanceof GrantRoleDefaultPrivileges ||
              change instanceof RevokeRoleDefaultPrivileges
            ) {
              return 0; // ALTER DEFAULT PRIVILEGES first (wrong order)
            }
            if (
              change.objectType === "role" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
              return 1; // CREATE ROLE second (wrong order)
            }
            if (
              change.objectType === "schema" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
              return 1; // CREATE SCHEMA second (wrong order)
            }
            return 2;
          };

          return priority(a) - priority(b);
        },
      });
    });

    test("constraint spec ensures ALTER DEFAULT PRIVILEGES comes before CREATE TABLE even with dependencies", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create roles and schema
          CREATE ROLE app_user;
          CREATE SCHEMA app;
        `,
        testSql: `
          -- Alter default privileges
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app 
            GRANT ALL ON TABLES TO app_user;
          
          -- Create a table (should use the new defaults)
          CREATE TABLE app.test_table (
            id integer PRIMARY KEY
          );
        `,
        sortChangesCallback: (a, b) => {
          // Force CREATE TABLE before ALTER DEFAULT PRIVILEGES to ensure
          // the constraint spec (which ensures ALTER DEFAULT PRIVILEGES comes before CREATE)
          // fixes the order even when dependencies would allow CREATE first
          const priority = (change: Change) => {
            if (
              change.objectType === "table" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
              return 0; // CREATE TABLE first (wrong order - constraint spec should fix this)
            }
            if (
              change instanceof GrantRoleDefaultPrivileges ||
              change instanceof RevokeRoleDefaultPrivileges
            ) {
              return 1; // ALTER DEFAULT PRIVILEGES second (wrong order)
            }
            return 2;
          };

          return priority(a) - priority(b);
        },
      });
    });
  });
}
