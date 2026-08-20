/**
 * Non-relocatable extensions whose drop+create-for-relocation would cascade
 * over user data columns (postgis: geometry/geography everywhere) must refuse
 * at plan time — a "converging" rebuild is the wrong answer.
 *
 * No Docker — synthetic fact bases exercise the planner gate.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const extensionsSchema: StableId = { kind: "schema", name: "extensions" };
const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

function bases(ext: Fact) {
  const desiredExt: Fact = {
    ...ext,
    payload: { ...ext.payload, schema: "extensions" },
  };
  const source = buildFactBase([f(publicSchema), f(extensionsSchema), ext], []);
  const desired = buildFactBase(
    [f(publicSchema), f(extensionsSchema), desiredExt],
    [],
  );
  return { source, desired };
}

describe("postgis non-relocation guard", () => {
  test("schema delta on postgis throws rather than planning a drop+create replace", () => {
    const postgis: StableId = { kind: "extension", name: "postgis" };
    const { source, desired } = bases(
      f(postgis, { schema: "public", _relocatable: false }),
    );
    expect(() => plan(source, desired)).toThrow(
      /extension "postgis" cannot be relocated from schema "public" to "extensions"/,
    );
    expect(() => plan(source, desired)).toThrow(
      /PostGIS cannot be relocated after install/,
    );
    expect(() => plan(source, desired)).toThrow(
      /align the schema declaration to the installed location \("public"\)/,
    );
  });

  test("a non-guarded non-relocatable extension still plans a replace", () => {
    const other: StableId = { kind: "extension", name: "foo" };
    const { source, desired } = bases(
      f(other, { schema: "public", _relocatable: false }),
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls.some((s) => /DROP EXTENSION "foo"/.test(s))).toBe(true);
    expect(sqls.some((s) => /CREATE EXTENSION "foo"/.test(s))).toBe(true);
  });

  test("a genuine DROP EXTENSION postgis still plans — the guard is relocation-only", () => {
    const postgis: StableId = { kind: "extension", name: "postgis" };
    const source = buildFactBase(
      [f(publicSchema), f(postgis, { schema: "public", _relocatable: false })],
      [],
    );
    const desired = buildFactBase([f(publicSchema)], []);
    const thePlan = plan(source, desired);
    expect(
      thePlan.actions.some((a) => /DROP EXTENSION "postgis"/.test(a.sql)),
    ).toBe(true);
    expect(
      thePlan.actions.some((a) => /CREATE EXTENSION "postgis"/.test(a.sql)),
    ).toBe(false);
  });
});
