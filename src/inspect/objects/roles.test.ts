import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectRoles } from "./roles.ts";

describe.concurrent("inspect roles", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of roles`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create role custom_role login;
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["custom_role"]);
        const [resultA, resultB] = await Promise.all([
          inspectRoles(db.a).then(filterResult),
          inspectRoles(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          custom_role: {
            can_bypass_rls: false,
            can_create_databases: false,
            can_create_roles: false,
            can_inherit: true,
            can_login: true,
            can_replicate: false,
            config: null,
            connection_limit: -1,
            is_superuser: false,
            role_name: "custom_role",
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
