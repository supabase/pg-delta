import { describe, expect, test } from "bun:test";
import type { Scenario } from "./corpus.ts";
import { mustRunSerially } from "./corpus-scheduling.ts";

const scenario = (overrides: Partial<Scenario> = {}): Scenario => ({
  name: "s",
  a: "CREATE TABLE public.t (id integer);",
  b: "CREATE TABLE public.t (id bigint);",
  meta: {},
  ...overrides,
});

describe("mustRunSerially", () => {
  test("serializes cluster-global role DDL in a reverse seed", () => {
    expect(
      mustRunSerially(scenario({ seedB: 'CREATE ROLE "reverse_seed_role";' })),
    ).toBe(true);
  });

  test("leaves database-local scenarios eligible for concurrency", () => {
    expect(mustRunSerially(scenario())).toBe(false);
  });
});
