import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import {
  buildIntentRuleIndex,
  buildRuleResolver,
  defaultRulesForId,
  type IntentKindRule,
} from "./rules.ts";

/** A toy cron-shaped intent rule, matching the pg_cron slice's contract. */
const cronJobRule: IntentKindRule = {
  payloadAttrs: ["schedule", "command", "database", "username", "active"],
  create: (fact) => {
    const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>).key;
    return [{ sql: `select cron.schedule('${key}', '* * * * *', 'select 1')` }];
  },
  drop: (fact) => {
    const key = (fact.id as Extract<StableId, { kind: "extensionIntent" }>).key;
    return { sql: `select cron.unschedule('${key}')`, dataLoss: "none" };
  },
};

const handlers = [{ extension: "pg_cron", intentKinds: { job: cronJobRule } }];

const intentId: StableId = {
  kind: "extensionIntent",
  ext: "pg_cron",
  intentKind: "job",
  key: "nightly",
};

const fact: Fact = {
  id: intentId,
  payload: {
    schedule: "* * * * *",
    command: "select 1",
    database: "postgres",
    username: "postgres",
    active: true,
  },
};

const view = buildFactBase([fact], []);

describe("intent rule resolver", () => {
  test("resolves a registered intent kind to a KindRules with the replay SQL", () => {
    const resolver = buildRuleResolver(buildIntentRuleIndex(handlers));
    const rules = resolver(intentId);
    expect(rules.create(fact, view)[0]!.sql).toContain("cron.schedule");
    expect(rules.drop(fact).sql).toContain("cron.unschedule");
  });

  test("marks every payload attr as replace (any change → drop+create)", () => {
    const rules = buildRuleResolver(buildIntentRuleIndex(handlers))(intentId);
    for (const attr of cronJobRule.payloadAttrs) {
      expect(rules.attributes[attr]).toBe("replace");
    }
  });

  test("weight defaults to 90 — later than every schema kind", () => {
    const rules = buildRuleResolver(buildIntentRuleIndex(handlers))(intentId);
    expect(rules.weight).toBe(90);
  });

  test("injects lockClass none unless a spec overrides it", () => {
    const rules = buildRuleResolver(buildIntentRuleIndex(handlers))(intentId);
    expect(rules.create(fact, view)[0]!.lockClass).toBe("none");
    expect(rules.drop(fact).lockClass).toBe("none");
  });

  test("omits rename/owner/defacl slots so the planner skips them", () => {
    const rules = buildRuleResolver(buildIntentRuleIndex(handlers))(intentId);
    expect(rules.rename).toBeUndefined();
    expect(rules.ownerAlterPrefix).toBeUndefined();
    expect(rules.defaclObjtype).toBeUndefined();
    expect(rules.metadata).toBeUndefined();
  });

  test("throws for an unregistered intent kind", () => {
    // no index at all
    expect(() => defaultRulesForId(intentId)).toThrow(
      /no intent rule registered/,
    );
    // registered ext, unknown intentKind
    const resolver = buildRuleResolver(buildIntentRuleIndex(handlers));
    expect(() =>
      resolver({
        kind: "extensionIntent",
        ext: "pg_cron",
        intentKind: "queue",
        key: "x",
      }),
    ).toThrow(/no intent rule registered/);
  });

  test("schema kinds still resolve through the static RULES table", () => {
    const resolver = buildRuleResolver(buildIntentRuleIndex(handlers));
    expect(resolver({ kind: "table", schema: "public", name: "t" })).toBe(
      defaultRulesForId({ kind: "table", schema: "public", name: "t" }),
    );
  });
});
