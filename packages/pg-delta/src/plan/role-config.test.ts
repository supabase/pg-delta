/**
 * Creating a role must materialize its GUC config (REVIEW_HANDOFF.md P1).
 * Role config was handled only as a set-delta on an already-existing role, so
 * an empty->configured-role plan emitted CREATE ROLE but dropped the
 * `ALTER ROLE ... SET ...` follow-ups — the created role silently lost its
 * config. A create rule must materialize every payload attribute that is not
 * carried by a child fact or edge.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { plan } from "./plan.ts";

const roleFact = (config: string[]): Fact => ({
  id: { kind: "role", name: "app_user" },
  payload: { login: true, inherit: true, config },
});

describe("role create materializes GUC config", () => {
  test("empty -> configured role emits ALTER ROLE ... SET", () => {
    const actions = plan(
      buildFactBase([], []),
      buildFactBase([roleFact(["statement_timeout=5s"])], []),
    ).actions;
    const sql = actions.map((a) => a.sql);
    expect(sql.some((s) => s.startsWith(`CREATE ROLE "app_user"`))).toBe(true);
    expect(sql).toContain(
      `ALTER ROLE "app_user" SET "statement_timeout" TO '5s'`,
    );
  });

  test("multiple config entries each emit a SET", () => {
    const actions = plan(
      buildFactBase([], []),
      buildFactBase(
        [roleFact(["statement_timeout=5s", "lock_timeout=1s"])],
        [],
      ),
    ).actions;
    const sql = actions.map((a) => a.sql);
    expect(sql).toContain(
      `ALTER ROLE "app_user" SET "statement_timeout" TO '5s'`,
    );
    expect(sql).toContain(`ALTER ROLE "app_user" SET "lock_timeout" TO '1s'`);
  });

  test("search_path list is per-element literals, not one quoted string", () => {
    // SET search_path TO 'a, b, c' stores one schema named "a, b, c".
    // SET search_path TO 'a', 'b', 'c' stores three schemas.
    const actions = plan(
      buildFactBase([], []),
      buildFactBase(
        [roleFact(["search_path=public, extensions, realtime"])],
        [],
      ),
    ).actions;
    const sql = actions.map((a) => a.sql);
    expect(sql).toContain(
      `ALTER ROLE "app_user" SET "search_path" TO 'public', 'extensions', 'realtime'`,
    );
    expect(sql).not.toContain(
      `ALTER ROLE "app_user" SET "search_path" TO 'public, extensions, realtime'`,
    );
  });

  test("search_path preserves $user and does not emit empty idents", () => {
    const actions = plan(
      buildFactBase([], []),
      buildFactBase([roleFact(['search_path="$user", public'])], []),
    ).actions;
    expect(actions.map((a) => a.sql)).toContain(
      `ALTER ROLE "app_user" SET "search_path" TO '$user', 'public'`,
    );
  });

  test("empty search_path emits TO '' not TO \"\"", () => {
    // ALTER ROLE … SET search_path TO '' stores search_path=""
    const fromEmpty = plan(
      buildFactBase([], []),
      buildFactBase([roleFact(["search_path="])], []),
    ).actions.map((a) => a.sql);
    const fromQuotedEmpty = plan(
      buildFactBase([], []),
      buildFactBase([roleFact(['search_path=""'])], []),
    ).actions.map((a) => a.sql);
    expect(fromEmpty).toContain(
      `ALTER ROLE "app_user" SET "search_path" TO ''`,
    );
    expect(fromQuotedEmpty).toContain(
      `ALTER ROLE "app_user" SET "search_path" TO ''`,
    );
    expect(fromEmpty.join("\n")).not.toContain(`TO ""`);
    expect(fromQuotedEmpty.join("\n")).not.toContain(`TO ""`);
  });
});
