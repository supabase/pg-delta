import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  AlterDefaultPrivilegesGrant,
  AlterDefaultPrivilegesRevoke,
} from "./changes/default-privilege.alter.ts";
import type { DefaultPrivilegeSet } from "./default-privilege.model.ts";

export function diffDefaultPrivileges(
  ctx: { version: number },
  main: Record<string, DefaultPrivilegeSet>,
  branch: Record<string, DefaultPrivilegeSet>,
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
        new AlterDefaultPrivilegesGrant({
          grantor: s.grantor,
          inSchema: s.in_schema,
          objtype: s.objtype,
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
        new AlterDefaultPrivilegesRevoke({
          grantor: s.grantor,
          inSchema: s.in_schema,
          objtype: s.objtype,
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
        const stillHasBase = b.privileges.some(
          (p) => p.privilege === privilege,
        );
        const upgraded = !wasGrantable && bSet.has(`${privilege}:true`);
        if (upgraded) {
          // base -> with grant option; do not revoke base
          continue;
        }
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
          new AlterDefaultPrivilegesGrant({
            grantor: b.grantor,
            inSchema: b.in_schema,
            objtype: b.objtype,
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
          new AlterDefaultPrivilegesRevoke({
            grantor: a.grantor,
            inSchema: a.in_schema,
            objtype: a.objtype,
            grantee: a.grantee,
            privileges: list,
            version: ctx.version,
          }),
        );
      }
    }
    if (revokeGrantOption.length > 0) {
      // Encode as GRANT OPTION revocation by marking grantable true
      changes.push(
        new AlterDefaultPrivilegesRevoke({
          grantor: a.grantor,
          inSchema: a.in_schema,
          objtype: a.objtype,
          grantee: a.grantee,
          privileges: revokeGrantOption.map((p) => ({
            privilege: p,
            grantable: true,
          })),
          version: ctx.version,
        }),
      );
    }
  }

  return changes;
}
