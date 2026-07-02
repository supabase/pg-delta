/**
 * withDatabaseName swaps only the database (path) segment of a connection URL,
 * preserving credentials, host, port, and query params.
 */
import { describe, expect, test } from "bun:test";
import { withDatabaseName } from "./shadow.ts";

describe("withDatabaseName", () => {
  test("swaps the dbname, keeps everything else", () => {
    expect(
      withDatabaseName(
        "postgres://u:p@host:5432/app?sslmode=require",
        "shadow",
      ),
    ).toBe("postgres://u:p@host:5432/shadow?sslmode=require");
  });

  test("handles a URL with no explicit database", () => {
    expect(withDatabaseName("postgres://u:p@host:5432", "shadow")).toBe(
      "postgres://u:p@host:5432/shadow",
    );
  });

  test("percent-encodes an unusual database name", () => {
    expect(withDatabaseName("postgres://host/app", "pgdelta_shadow_x")).toBe(
      "postgres://host/pgdelta_shadow_x",
    );
  });
});
