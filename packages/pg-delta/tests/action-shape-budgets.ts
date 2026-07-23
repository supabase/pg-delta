/** Test-only semantic assertions over an uncompacted plan's action shape. */
import {
  ALL_FACT_KINDS,
  encodeId,
  type FactKind,
  type StableId,
} from "../src/core/stable-id.ts";
import type { Action } from "../src/plan/plan.ts";
import { CorpusContractError } from "./corpus-contract.ts";

const SHAPES = ["create", "alter", "drop", "replacement", "rename"] as const;

type Shape = (typeof SHAPES)[number];

interface ShapeSelector {
  shape: Shape;
  kind: FactKind;
}

type Expectation = "require" | "forbid";

interface AssertionRef {
  expectation: Expectation;
  selector: ShapeSelector;
}

interface ExpectedFailure {
  assertion: AssertionRef;
  issue: string;
  reason: string;
}

interface DirectionBudget {
  require?: ShapeSelector[];
  forbid?: ShapeSelector[];
  expectedFailure?: ExpectedFailure;
}

interface ActionShapeBudget {
  "a-to-b"?: DirectionBudget;
  "b-to-a"?: DirectionBudget;
}

type Direction = "forward" | "reverse";

const SHAPE_SET = new Set<string>(SHAPES);
const FACT_KIND_SET = new Set<string>(ALL_FACT_KINDS);

export class ActionShapeBudgetError extends CorpusContractError {
  constructor(message: string) {
    super(message);
    this.name = "ActionShapeBudgetError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(context: string, message: string): never {
  throw new ActionShapeBudgetError(`${context}: ${message}`);
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail(context, `unknown field "${field}"`);
  }
}

function parseSelector(value: unknown, context: string): ShapeSelector {
  if (typeof value !== "string") {
    fail(context, `selector must be a string, got ${typeof value}`);
  }
  const parts = value.split(":");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    fail(context, `invalid selector "${value}"; expected shape:FactKind`);
  }
  const [shape, kind] = parts as [string, string];
  if (!SHAPE_SET.has(shape)) {
    fail(context, `unknown action shape "${shape}" in selector "${value}"`);
  }
  if (!FACT_KIND_SET.has(kind)) {
    fail(context, `unknown fact kind "${kind}" in selector "${value}"`);
  }
  return { shape: shape as Shape, kind: kind as FactKind };
}

function parseSelectorList(value: unknown, context: string): ShapeSelector[] {
  if (!Array.isArray(value)) fail(context, "selectors must be an array");
  if (value.length === 0) fail(context, "selector list must not be empty");
  const parsed = value.map((selector, index) =>
    parseSelector(selector, `${context}[${index}]`),
  );
  const seen = new Set<string>();
  for (const selector of parsed) {
    const key = selectorKey(selector);
    if (seen.has(key)) fail(context, `duplicate selector "${key}"`);
    seen.add(key);
  }
  return parsed;
}

function parseAssertionRef(value: unknown, context: string): AssertionRef {
  if (typeof value !== "string") {
    fail(context, `assertion must be a string, got ${typeof value}`);
  }
  const separator = value.indexOf(":");
  if (separator < 1) {
    fail(
      context,
      `invalid assertion "${value}"; expected require|forbid:shape:FactKind`,
    );
  }
  const expectation = value.slice(0, separator);
  if (expectation !== "require" && expectation !== "forbid") {
    fail(context, `unknown assertion expectation "${expectation}"`);
  }
  return {
    expectation,
    selector: parseSelector(value.slice(separator + 1), context),
  };
}

function parseExpectedFailure(
  value: unknown,
  context: string,
): ExpectedFailure {
  if (!isRecord(value)) fail(context, "expected an object");
  assertKnownFields(value, new Set(["assertion", "issue", "reason"]), context);
  const { assertion, issue, reason } = value;
  const parsedAssertion = parseAssertionRef(assertion, `${context}.assertion`);
  if (typeof issue !== "string" || issue.trim() === "") {
    fail(context, "issue must be a non-empty string");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    fail(context, "reason must be a non-empty string");
  }
  return { assertion: parsedAssertion, issue, reason };
}

function parseDirectionBudget(
  value: unknown,
  context: string,
): DirectionBudget {
  if (!isRecord(value)) fail(context, "direction budget must be an object");
  assertKnownFields(
    value,
    new Set(["require", "forbid", "expectedFailure"]),
    context,
  );

  const parsed: DirectionBudget = {};
  if (value["require"] !== undefined) {
    parsed.require = parseSelectorList(value["require"], `${context}.require`);
  }
  if (value["forbid"] !== undefined) {
    parsed.forbid = parseSelectorList(value["forbid"], `${context}.forbid`);
  }
  if (value["expectedFailure"] !== undefined) {
    parsed.expectedFailure = parseExpectedFailure(
      value["expectedFailure"],
      `${context}.expectedFailure`,
    );
  }
  const required = new Set((parsed.require ?? []).map(selectorKey));
  const forbidden = new Set((parsed.forbid ?? []).map(selectorKey));
  if (required.size + forbidden.size === 0) {
    fail(context, "direction budget must declare at least one assertion");
  }
  for (const key of required) {
    if (forbidden.has(key)) {
      fail(context, `selector is both required and forbidden: "${key}"`);
    }
  }
  if (parsed.expectedFailure !== undefined) {
    const expected = parsed.expectedFailure.assertion;
    const declared = expected.expectation === "require" ? required : forbidden;
    const key = selectorKey(expected.selector);
    if (!declared.has(key)) {
      fail(
        `${context}.expectedFailure.assertion`,
        `assertion "${expected.expectation}:${key}" is not declared`,
      );
    }
  }
  return parsed;
}

export function parseActionShapeBudget(
  input: unknown,
  context: string,
): ActionShapeBudget {
  if (!isRecord(input)) fail(context, "budget must be an object");
  assertKnownFields(input, new Set(["a-to-b", "b-to-a"]), context);

  const parsed: ActionShapeBudget = {};
  if (input["a-to-b"] !== undefined) {
    parsed["a-to-b"] = parseDirectionBudget(
      input["a-to-b"],
      `${context}.a-to-b`,
    );
  }
  if (input["b-to-a"] !== undefined) {
    parsed["b-to-a"] = parseDirectionBudget(
      input["b-to-a"],
      `${context}.b-to-a`,
    );
  }
  if (parsed["a-to-b"] === undefined && parsed["b-to-a"] === undefined) {
    fail(context, "budget must declare at least one direction");
  }
  return parsed;
}

function selectorKey(selector: ShapeSelector): string {
  return `${selector.shape}:${selector.kind}`;
}

function addObservation(
  observations: Map<string, string[]>,
  shape: Shape,
  id: StableId,
  display = encodeId(id),
): void {
  const key = `${shape}:${id.kind}`;
  const ids = observations.get(key) ?? [];
  ids.push(display);
  observations.set(key, ids);
}

function isRenameAction(action: Action): boolean {
  return (
    action.verb === "alter" &&
    action.produces.length > 0 &&
    action.destroys.length > 0
  );
}

function rawSubject(action: Action): StableId | undefined {
  if (action.verb === "alter") {
    // A rename consumes its parent but produces/destroys the renamed subtree,
    // so its new root is the semantic subject. Ordinary alters consume the fact
    // they change; produces/destroys may only describe graph side effects such
    // as an identity column's backing sequence.
    return isRenameAction(action)
      ? action.produces[0]
      : (action.consumes[0] ?? action.produces[0] ?? action.destroys[0]);
  }
  return action.produces[0] ?? action.destroys[0] ?? action.consumes[0];
}

function observeActions(actions: readonly Action[]): Map<string, string[]> {
  const observations = new Map<string, string[]>();
  const dropped = new Map<string, StableId>();
  const created = new Map<string, StableId>();

  for (const action of actions) {
    const subject = rawSubject(action);
    if (subject !== undefined) {
      addObservation(observations, action.verb, subject);
    }

    if (action.verb === "drop") {
      for (const id of action.destroys) dropped.set(encodeId(id), id);
    } else if (action.verb === "create") {
      for (const id of action.produces) created.set(encodeId(id), id);
    } else if (isRenameAction(action)) {
      const producedRoot = action.produces[0] as StableId;
      const destroyedRoot = action.destroys[0] as StableId;
      addObservation(
        observations,
        "rename",
        producedRoot,
        `${encodeId(destroyedRoot)} -> ${encodeId(producedRoot)}`,
      );
    }
  }

  // A replacement is semantic, not a raw action verb: the same exact stable id
  // must be destroyed by a drop and produced by a create. Encoded equality keeps
  // routine signatures, ACL columns, and every other identity component intact.
  for (const [encoded, id] of dropped) {
    if (created.has(encoded)) {
      addObservation(observations, "replacement", id, encoded);
    }
  }
  return observations;
}

interface Violation {
  selector: ShapeSelector;
  expectation: Expectation;
  ids: string[];
}

function assertionKey(assertion: AssertionRef | Violation): string {
  return `${assertion.expectation}:${selectorKey(assertion.selector)}`;
}

function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(({ selector, expectation, ids }) => {
      const expected = expectation === "require" ? ">=1" : "0";
      return `${selectorKey(selector)} expected=${expected} actual=${ids.length} ids=[${ids.join(", ")}]`;
    })
    .join("; ");
}

function issueLabel(issue: string): string {
  const match = /\/issues\/(\d+)(?:[/?#]|$)/.exec(issue);
  return match?.[1] === undefined ? issue : `#${match[1]}`;
}

export function enforceActionShapeBudget(
  actions: readonly Action[],
  budget: ActionShapeBudget,
  scenarioName: string,
  direction: Direction,
): void {
  const directionBudget = budget[direction === "forward" ? "a-to-b" : "b-to-a"];
  if (directionBudget === undefined) return;

  const observations = observeActions(actions);
  const violations: Violation[] = [];
  for (const selector of directionBudget.require ?? []) {
    const ids = [...(observations.get(selectorKey(selector)) ?? [])].sort();
    if (ids.length === 0) {
      violations.push({ selector, expectation: "require", ids });
    }
  }
  for (const selector of directionBudget.forbid ?? []) {
    const ids = [...(observations.get(selectorKey(selector)) ?? [])].sort();
    if (ids.length > 0) {
      violations.push({ selector, expectation: "forbid", ids });
    }
  }

  const expectedFailure = directionBudget.expectedFailure;
  if (expectedFailure !== undefined) {
    const expectedKey = assertionKey(expectedFailure.assertion);
    const expectedViolation = violations.some(
      (violation) => assertionKey(violation) === expectedKey,
    );
    const unexpected = violations.filter(
      (violation) => assertionKey(violation) !== expectedKey,
    );
    if (unexpected.length > 0) {
      throw new ActionShapeBudgetError(
        `[${scenarioName}:${direction}] unexpected action-shape budget violation while ${issueLabel(expectedFailure.issue)} is pinned: ${formatViolations(unexpected)}`,
      );
    }
    if (expectedViolation) return;
    throw new ActionShapeBudgetError(
      `[${scenarioName}:${direction}] expected failure ${issueLabel(expectedFailure.issue)} now passes: ${expectedFailure.reason}`,
    );
  }
  if (violations.length === 0) return;

  throw new ActionShapeBudgetError(
    `[${scenarioName}:${direction}] action-shape budget violation: ${formatViolations(violations)}`,
  );
}

/** Keep C1's two plan artifacts isolated: semantic budgets describe the
 *  correctness-first uncompacted shape, never cosmetic compaction output. */
export function enforceActionShapeBudgetForMode(
  compact: boolean,
  actions: readonly Action[],
  budget: ActionShapeBudget | undefined,
  scenarioName: string,
  direction: Direction,
): void {
  if (compact || budget === undefined) return;
  enforceActionShapeBudget(actions, budget, scenarioName, direction);
}
