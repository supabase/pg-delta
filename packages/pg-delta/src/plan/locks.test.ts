/**
 * Targeted per-form assertions for the vetted lock-class table (stage 5
 * deliverable 7): each entry mirrors PostgreSQL's documented lock level.
 */
import { describe, expect, test } from "bun:test";
import { lockClassFor } from "./locks.ts";

describe("vetted lock-class table", () => {
  test("ALTER TABLE forms take ACCESS EXCLUSIVE", () => {
    expect(lockClassFor("table", "alter")).toBe("accessExclusive");
    expect(lockClassFor("column", "create")).toBe("accessExclusive");
    expect(lockClassFor("column", "alter")).toBe("accessExclusive");
    expect(lockClassFor("default", "create")).toBe("accessExclusive");
  });

  test("CREATE INDEX takes SHARE; DROP INDEX takes ACCESS EXCLUSIVE", () => {
    expect(lockClassFor("index", "create")).toBe("share");
    expect(lockClassFor("index", "drop")).toBe("accessExclusive");
  });

  test("CREATE TRIGGER takes SHARE ROW EXCLUSIVE", () => {
    expect(lockClassFor("trigger", "create")).toBe("shareRowExclusive");
  });

  test("ALTER PUBLICATION SET takes SHARE UPDATE EXCLUSIVE on listed tables", () => {
    expect(lockClassFor("publication", "alter")).toBe("shareUpdateExclusive");
  });

  test("creating new relations locks nothing existing", () => {
    expect(lockClassFor("table", "create")).toBe("none");
    expect(lockClassFor("view", "create")).toBe("none");
    expect(lockClassFor("sequence", "create")).toBe("none");
  });

  test("cluster-level and catalog-only kinds report none", () => {
    expect(lockClassFor("role", "create")).toBe("none");
    expect(lockClassFor("schema", "drop")).toBe("none");
    expect(lockClassFor("comment", "alter")).toBe("none");
    expect(lockClassFor("acl", "create")).toBe("none");
  });

  test("unknown kinds report the conservative worst case", () => {
    expect(lockClassFor("mystery", "alter")).toBe("accessExclusive");
  });
});
