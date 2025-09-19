import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
import { GrantRoleMembership } from "./changes/membership.create.ts";
import {
  RevokeMembershipOptions,
  RevokeRoleMembership,
} from "./changes/membership.drop.ts";
import type { RoleMembership } from "./membership.model.ts";

export function diffRoleMemberships(
  main: Record<string, RoleMembership>,
  branch: Record<string, RoleMembership>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);
  const changes: Change[] = [];

  for (const id of created) {
    const m = branch[id];
    changes.push(
      new GrantRoleMembership({
        role: m.role,
        member: m.member,
        options: {
          admin: m.admin_option,
          inherit: m.inherit_option ?? null,
          set: m.set_option ?? null,
        },
      }),
    );
  }

  for (const id of dropped) {
    const m = main[id];
    changes.push(new RevokeRoleMembership({ role: m.role, member: m.member }));
  }

  for (const id of altered) {
    const a = main[id];
    const b = branch[id];
    const toRevoke: { admin?: boolean; inherit?: boolean; set?: boolean } = {};
    const toGrant: { admin?: boolean; inherit?: boolean; set?: boolean } = {};

    if (a.admin_option !== b.admin_option) {
      if (b.admin_option) toGrant.admin = true;
      else toRevoke.admin = true;
    }
    if ((a.inherit_option ?? null) !== (b.inherit_option ?? null)) {
      if (b.inherit_option) toGrant.inherit = true;
      else toRevoke.inherit = true;
    }
    if ((a.set_option ?? null) !== (b.set_option ?? null)) {
      if (b.set_option) toGrant.set = true;
      else toRevoke.set = true;
    }

    if (toRevoke.admin || toRevoke.inherit || toRevoke.set) {
      changes.push(
        new RevokeMembershipOptions({
          role: a.role,
          member: a.member,
          admin: toRevoke.admin,
          inherit: toRevoke.inherit,
          set: toRevoke.set,
        }),
      );
    }
    if (toGrant.admin || toGrant.inherit || toGrant.set) {
      changes.push(
        new GrantRoleMembership({
          role: b.role,
          member: b.member,
          options: {
            admin: !!toGrant.admin,
            inherit: toGrant.inherit ?? null,
            set: toGrant.set ?? null,
          },
        }),
      );
    }
  }

  return changes;
}
