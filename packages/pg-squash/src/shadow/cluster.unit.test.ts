import { describe, expect, test } from "bun:test";
import { maintenanceConnectionString } from "./cluster.ts";

describe("maintenanceConnectionString", () => {
  test("leaves the URL alone when it is not the baseline", () => {
    expect(
      maintenanceConnectionString(
        "postgres://u:p@localhost:5432/app",
        "template0",
      ),
    ).toBe("postgres://u:p@localhost:5432/app");
  });

  test("moves off a non-postgres baseline onto postgres", () => {
    expect(
      maintenanceConnectionString("postgres://u:p@localhost:5432/app", "app"),
    ).toBe("postgres://u:p@localhost:5432/postgres");
  });

  test("moves off postgres onto template1", () => {
    expect(
      maintenanceConnectionString(
        "postgres://u:p@localhost:5432/postgres?sslmode=disable",
        "postgres",
      ),
    ).toBe("postgres://u:p@localhost:5432/template1?sslmode=disable");
  });
});
