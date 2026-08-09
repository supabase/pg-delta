import {
  buildFactBase,
  retainOwnerRoleDangling,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import {
  encodeId,
  type FactKind,
  parseId,
  type StableId,
} from "../core/stable-id.ts";

/** Every stable-id kind that embeds a role name. */
export const ROLE_NAME_BEARING_KINDS: ReadonlySet<FactKind> = new Set([
  "role",
  "membership",
  "userMapping",
  "defaultPrivilege",
  "acl",
  "comment",
  "securityLabel",
]);

/** Build the source-role-name to desired-role-name map from accepted renames. */
export function buildRoleRenameMap(
  acceptedRenames: ReadonlyArray<{ from: Fact; to: Fact }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const { from, to } of acceptedRenames) {
    if (from.id.kind === "role" && to.id.kind === "role") {
      map.set(from.id.name, to.id.name);
    }
  }
  return map;
}

/** Relabel every role name embedded in a stable id into desired-name space. */
export function relabelRoleNames(
  id: StableId,
  rename: ReadonlyMap<string, string>,
): StableId {
  const remap = (name: string): string => rename.get(name) ?? name;
  // Spread every id before overriding role-bearing fields. In particular, this
  // preserves the optional `column` qualifier on column-level ACL ids.
  switch (id.kind) {
    case "role":
      return { ...id, name: remap(id.name) };
    case "membership":
      return { ...id, role: remap(id.role), member: remap(id.member) };
    case "userMapping":
      return { ...id, role: remap(id.role) };
    case "defaultPrivilege":
      return { ...id, role: remap(id.role), grantee: remap(id.grantee) };
    case "acl":
      return {
        ...id,
        target: relabelRoleNames(id.target, rename),
        grantee: remap(id.grantee),
      };
    case "comment":
      return { ...id, target: relabelRoleNames(id.target, rename) };
    case "securityLabel":
      return { ...id, target: relabelRoleNames(id.target, rename) };
    default:
      return id;
  }
}

function normalizePayload(
  id: StableId,
  payload: Payload,
  rename: ReadonlyMap<string, string>,
): Payload {
  // Structured policy role references are OID-carried by PostgreSQL. This is
  // the only known role-bearing payload field; do not rewrite arbitrary text
  // (function bodies, extension-intent usernames/commands, and so on).
  if (id.kind !== "policy" || !Array.isArray(payload.roles)) return payload;
  const roles = payload.roles;
  if (!roles.every((role): role is string => typeof role === "string")) {
    return payload;
  }
  return {
    ...payload,
    roles: roles.map((role) => rename.get(role) ?? role).sort(),
  };
}

/**
 * Rewrite role-name-bearing identity into the desired (post-rename) namespace.
 *
 * The planner applies this after its policy-filtered rename discovery pass and
 * before the canonical diff that drives actions.
 */
export function normalizeRoleIdentities(
  fb: FactBase,
  roleRenameMap: ReadonlyMap<string, string>,
): FactBase {
  if (roleRenameMap.size === 0) return fb;

  const facts = fb.facts().map(
    (fact): Fact => ({
      id: relabelRoleNames(fact.id, roleRenameMap),
      ...(fact.parent === undefined
        ? {}
        : { parent: relabelRoleNames(fact.parent, roleRenameMap) }),
      payload: normalizePayload(fact.id, fact.payload, roleRenameMap),
    }),
  );
  const edges = fb.edges.map((edge) => ({
    ...edge,
    from: relabelRoleNames(edge.from, roleRenameMap),
    to: relabelRoleNames(edge.to, roleRenameMap),
  }));
  const referenceOnly = new Set(
    [...fb.referenceOnly].map((encoded) =>
      encodeId(relabelRoleNames(parseId(encoded), roleRenameMap)),
    ),
  );
  const normalized = buildFactBase(facts, edges, fb.source, referenceOnly, {
    allowDangling: retainOwnerRoleDangling,
  });
  normalized.diagnostics.push(...fb.diagnostics);
  return normalized;
}
