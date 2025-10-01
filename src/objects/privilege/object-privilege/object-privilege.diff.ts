import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  GrantObjectPrivileges,
  RevokeGrantOptionObjectPrivileges,
  RevokeObjectPrivileges,
} from "./changes/object-privilege.alter.ts";
import type { ObjectPrivilegeSet } from "./object-privilege.model.ts";

function sqlQualifiedName(
  kind: string,
  schema: string | null,
  name: string,
  argTypes: string[] | null,
): string {
  if (kind === "LANGUAGE" || kind === "SCHEMA") return name;
  if (kind === "ROUTINE") {
    const args =
      argTypes && argTypes.length > 0 ? `(${argTypes.join(", ")})` : `()`;
    return `${schema}.${name}${args}`;
  }
  if (schema) return `${schema}.${name}`;
  return name;
}

export function diffObjectPrivileges(
  ctx: { version: number },
  main: Record<string, ObjectPrivilegeSet>,
  branch: Record<string, ObjectPrivilegeSet>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);
  const changes: Change[] = [];

  for (const id of created) {
    const s = branch[id];
    if (s.privileges.length === 0) continue;
    const grantGroups = new Map<
      boolean,
      { privilege: string; grantable: boolean }[]
    >();
    for (const p of s.privileges) {
      const arr = grantGroups.get(p.grantable) ?? [];
      arr.push(p);
      grantGroups.set(p.grantable, arr);
    }
    for (const [grantable, list] of grantGroups) {
      void grantable;
      changes.push(
        new GrantObjectPrivileges({
          objectId: s.target_stable_id,
          objectNameSql: sqlQualifiedName(
            s.target_kind,
            s.schema,
            s.name,
            s.arg_types,
          ),
          objectKind: s.target_kind,
          grantee: s.grantee,
          privileges: list,
          version: ctx.version,
        }),
      );
    }
  }

  for (const id of dropped) {
    const s = main[id];
    if (s.privileges.length === 0) continue;
    const revokeGroups = new Map<
      boolean,
      { privilege: string; grantable: boolean }[]
    >();
    for (const p of s.privileges) {
      const arr = revokeGroups.get(p.grantable) ?? [];
      arr.push(p);
      revokeGroups.set(p.grantable, arr);
    }
    for (const [grantable, list] of revokeGroups) {
      void grantable;
      changes.push(
        new RevokeObjectPrivileges({
          objectId: s.target_stable_id,
          objectNameSql: sqlQualifiedName(
            s.target_kind,
            s.schema,
            s.name,
            s.arg_types,
          ),
          objectKind: s.target_kind,
          grantee: s.grantee,
          privileges: list,
          version: ctx.version,
        }),
      );
    }
  }

  for (const id of altered) {
    const a = main[id];
    const b = branch[id];
    const toKey = (p: { privilege: string; grantable: boolean }) =>
      `${p.privilege}:${p.grantable}`;
    const aSet = new Set(a.privileges.map(toKey));
    const bSet = new Set(b.privileges.map(toKey));

    const grants: { privilege: string; grantable: boolean }[] = [];
    const revokes: { privilege: string; grantable: boolean }[] = [];
    const revokeGrantOption: string[] = [];

    for (const key of bSet) {
      if (!aSet.has(key)) {
        const [privilege, grantableStr] = key.split(":");
        grants.push({ privilege, grantable: grantableStr === "true" });
      }
    }

    for (const key of aSet) {
      if (!bSet.has(key)) {
        const [privilege, grantableStr] = key.split(":");
        const wasGrantable = grantableStr === "true";
        // Upgrade: base -> with grant option (no base revoke)
        const upgraded = !wasGrantable && bSet.has(`${privilege}:true`);
        if (upgraded) continue;
        // If only grantable flipped from true to false, emit REVOKE GRANT OPTION FOR
        const stillHasBase = b.privileges.some(
          (p) => p.privilege === privilege,
        );
        if (wasGrantable && stillHasBase) {
          revokeGrantOption.push(privilege);
        } else {
          revokes.push({ privilege, grantable: wasGrantable });
        }
      }
    }

    if (grants.length > 0) {
      const grantGroups = new Map<
        boolean,
        { privilege: string; grantable: boolean }[]
      >();
      for (const p of grants) {
        const arr = grantGroups.get(p.grantable) ?? [];
        arr.push(p);
        grantGroups.set(p.grantable, arr);
      }
      for (const [grantable, list] of grantGroups) {
        void grantable;
        changes.push(
          new GrantObjectPrivileges({
            objectId: b.target_stable_id,
            objectNameSql: sqlQualifiedName(
              b.target_kind,
              b.schema,
              b.name,
              b.arg_types,
            ),
            objectKind: b.target_kind,
            grantee: b.grantee,
            privileges: list,
            version: ctx.version,
          }),
        );
      }
    }
    if (revokes.length > 0) {
      const revokeGroups = new Map<
        boolean,
        { privilege: string; grantable: boolean }[]
      >();
      for (const p of revokes) {
        const arr = revokeGroups.get(p.grantable) ?? [];
        arr.push(p);
        revokeGroups.set(p.grantable, arr);
      }
      for (const [grantable, list] of revokeGroups) {
        void grantable;
        changes.push(
          new RevokeObjectPrivileges({
            objectId: a.target_stable_id,
            objectNameSql: sqlQualifiedName(
              a.target_kind,
              a.schema,
              a.name,
              a.arg_types,
            ),
            objectKind: a.target_kind,
            grantee: a.grantee,
            privileges: list,
            version: ctx.version,
          }),
        );
      }
    }
    if (revokeGrantOption.length > 0) {
      changes.push(
        new RevokeGrantOptionObjectPrivileges({
          objectId: a.target_stable_id,
          objectNameSql: sqlQualifiedName(
            a.target_kind,
            a.schema,
            a.name,
            a.arg_types,
          ),
          objectKind: a.target_kind,
          grantee: a.grantee,
          privilegeNames: revokeGrantOption,
          version: ctx.version,
        }),
      );
    }
  }

  return changes;
}
