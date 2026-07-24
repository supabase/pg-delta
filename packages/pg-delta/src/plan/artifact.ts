/**
 * Plan artifact v1 (stage 6 deliverable 1): a plan is a durable,
 * version-tagged JSON document that round-trips losslessly. `apply`
 * accepts the artifact, never a bare SQL list, and refuses artifacts
 * whose formatVersion/engineVersion it does not understand (the version
 * check itself lives in apply.ts; this module owns the byte format).
 *
 * Payload values can contain bigints (sequence bounds); they are encoded
 * as {"$bigint": "…"} exactly like fact snapshots (stage 1).
 */
import { ALL_FACT_KINDS, type StableId } from "../core/stable-id.ts";
import { ENGINE_VERSION, type Action, type Plan } from "./plan.ts";

const ACTION_VERBS = new Set(["create", "alter", "drop"]);
const TRANSACTIONALITY = new Set([
  "transactional",
  "nonTransactional",
  "commitBoundaryAfter",
]);
const LOCK_CLASSES = new Set([
  "none",
  "share",
  "shareRowExclusive",
  "shareUpdateExclusive",
  "accessExclusive",
]);
const DATA_LOSS = new Set(["none", "destructive"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, expected: string): never {
  throw new Error(`plan artifact: ${path} must be ${expected}`);
}

function stringField(
  value: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") fail(`${path}.${field}`, "a string");
  return fieldValue;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const key of required) {
    if (!(key in value)) fail(`${path}.${key}`, "present");
  }
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra !== undefined) fail(`${path}.${extra}`, "a recognized field");
}

function assertStableId(
  value: unknown,
  path: string,
): asserts value is StableId {
  if (!record(value)) fail(path, "a stable ID object");
  const kind = stringField(value, "kind", path);
  if (!(ALL_FACT_KINDS as readonly string[]).includes(kind)) {
    fail(`${path}.kind`, "a recognized stable ID kind");
  }
  const strings = (...fields: string[]): void => {
    for (const field of fields) stringField(value, field, path);
  };
  if (
    [
      "schema",
      "role",
      "extension",
      "language",
      "eventTrigger",
      "publication",
      "subscription",
      "fdw",
      "server",
    ].includes(kind)
  ) {
    exactKeys(value, ["kind", "name"], [], path);
    strings("name");
    return;
  }
  if (
    [
      "table",
      "view",
      "materializedView",
      "foreignTable",
      "sequence",
      "index",
      "collation",
      "domain",
      "type",
    ].includes(kind)
  ) {
    exactKeys(value, ["kind", "schema", "name"], [], path);
    strings("schema", "name");
    return;
  }
  if (
    ["column", "constraint", "trigger", "rule", "policy", "default"].includes(
      kind,
    )
  ) {
    exactKeys(value, ["kind", "schema", "table", "name"], [], path);
    strings("schema", "table", "name");
    return;
  }
  if (["function", "procedure", "aggregate"].includes(kind)) {
    exactKeys(value, ["kind", "schema", "name", "args"], [], path);
    strings("schema", "name");
    if (
      !Array.isArray(value["args"]) ||
      value["args"].some((arg) => typeof arg !== "string")
    ) {
      fail(`${path}.args`, "an array of strings");
    }
    return;
  }
  switch (kind) {
    case "membership":
      exactKeys(value, ["kind", "role", "member"], [], path);
      strings("role", "member");
      return;
    case "userMapping":
      exactKeys(value, ["kind", "server", "role"], [], path);
      strings("server", "role");
      return;
    case "typeAttribute":
      exactKeys(value, ["kind", "schema", "type", "name"], [], path);
      strings("schema", "type", "name");
      return;
    case "publicationRel":
      exactKeys(value, ["kind", "publication", "schema", "table"], [], path);
      strings("publication", "schema", "table");
      return;
    case "publicationSchema":
      exactKeys(value, ["kind", "publication", "schema"], [], path);
      strings("publication", "schema");
      return;
    case "comment":
      exactKeys(value, ["kind", "target"], [], path);
      assertStableId(value["target"], `${path}.target`);
      return;
    case "acl":
      exactKeys(value, ["kind", "target", "grantee"], ["column"], path);
      assertStableId(value["target"], `${path}.target`);
      strings("grantee");
      if (
        value["column"] !== undefined &&
        typeof value["column"] !== "string"
      ) {
        fail(`${path}.column`, "a string");
      }
      return;
    case "securityLabel":
      exactKeys(value, ["kind", "target", "provider"], [], path);
      assertStableId(value["target"], `${path}.target`);
      strings("provider");
      return;
    case "defaultPrivilege":
      exactKeys(
        value,
        ["kind", "role", "schema", "objtype", "grantee"],
        [],
        path,
      );
      strings("role", "objtype", "grantee");
      if (value["schema"] !== null && typeof value["schema"] !== "string") {
        fail(`${path}.schema`, "a string or null");
      }
      return;
    case "extensionIntent":
      exactKeys(value, ["kind", "ext", "intentKind", "key"], [], path);
      strings("ext", "intentKind", "key");
      return;
  }
  fail(`${path}.kind`, "a recognized stable ID kind");
}

function assertIdArray(
  value: unknown,
  path: string,
): asserts value is StableId[] {
  if (!Array.isArray(value)) fail(path, "an array");
  value.forEach((id, index) => assertStableId(id, `${path}[${index}]`));
}

function assertAction(value: unknown, index: number): asserts value is Action {
  const path = `actions[${index}]`;
  if (!record(value)) fail(path, "an object");
  stringField(value, "sql", path);
  const verb = stringField(value, "verb", path);
  if (!ACTION_VERBS.has(verb)) fail(`${path}.verb`, "create, alter, or drop");
  for (const field of ["produces", "consumes", "destroys", "releases"]) {
    assertIdArray(value[field], `${path}.${field}`);
  }
  const transactionality = stringField(value, "transactionality", path);
  if (!TRANSACTIONALITY.has(transactionality)) {
    fail(`${path}.transactionality`, "a recognized transactionality value");
  }
  const lockClass = stringField(value, "lockClass", path);
  if (!LOCK_CLASSES.has(lockClass)) {
    fail(`${path}.lockClass`, "a recognized lock class");
  }
  if (typeof value["newSegmentBefore"] !== "boolean") {
    fail(`${path}.newSegmentBefore`, "a boolean");
  }
  const dataLoss = stringField(value, "dataLoss", path);
  if (!DATA_LOSS.has(dataLoss)) {
    fail(`${path}.dataLoss`, "none or destructive");
  }
  if (typeof value["rewriteRisk"] !== "boolean") {
    fail(`${path}.rewriteRisk`, "a boolean");
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "$bigint" in value &&
    typeof (value as { $bigint: unknown }).$bigint === "string" &&
    Object.keys(value).length === 1
  ) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

export function serializePlan(thePlan: Plan): string {
  return JSON.stringify(thePlan, replacer, 2);
}

export function parsePlan(json: string): Plan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json, reviver);
  } catch (error) {
    throw new Error(
      `plan artifact: not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("plan artifact: expected a JSON object");
  }
  const artifact = parsed as Partial<Plan>;
  if (artifact.formatVersion !== 1) {
    throw new Error(
      `plan artifact: unsupported formatVersion ${String(artifact.formatVersion)} (this engine reads 1)`,
    );
  }
  if (typeof artifact.engineVersion !== "string") {
    throw new Error("plan artifact: missing engineVersion");
  }
  if (artifact.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `plan artifact: produced by engine ${artifact.engineVersion}, this engine is ${ENGINE_VERSION} — re-plan`,
    );
  }
  if (!Array.isArray(artifact.actions) || !Array.isArray(artifact.deltas)) {
    throw new Error("plan artifact: missing actions/deltas");
  }
  artifact.actions.forEach(assertAction);
  if (artifact.acceptedRenames !== undefined) {
    if (!Array.isArray(artifact.acceptedRenames)) {
      fail("acceptedRenames", "an array");
    }
    artifact.acceptedRenames.forEach((rename, index) => {
      if (!record(rename)) fail(`acceptedRenames[${index}]`, "an object");
      exactKeys(rename, ["from", "to"], [], `acceptedRenames[${index}]`);
      assertStableId(rename["from"], `acceptedRenames[${index}].from`);
      assertStableId(rename["to"], `acceptedRenames[${index}].to`);
    });
  }
  if (
    artifact.source?.fingerprint === undefined ||
    artifact.target?.fingerprint === undefined
  ) {
    throw new Error("plan artifact: missing source/target fingerprints");
  }
  return artifact as Plan;
}
