import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import {
  AlterSubscriptionDisable,
  AlterSubscriptionEnable,
  AlterSubscriptionSetConnection,
  AlterSubscriptionSetOptions,
  AlterSubscriptionSetOwner,
  AlterSubscriptionSetPublication,
} from "./changes/subscription.alter.ts";
import {
  CreateCommentOnSubscription,
  DropCommentOnSubscription,
} from "./changes/subscription.comment.ts";
import { CreateSubscription } from "./changes/subscription.create.ts";
import { DropSubscription } from "./changes/subscription.drop.ts";
import type { SubscriptionChange } from "./changes/subscription.types.ts";
import type { Subscription } from "./subscription.model.ts";
import type { SubscriptionSettableOption } from "./utils.ts";

const NON_ALTERABLE_FIELDS: Array<keyof Subscription["dataFields"]> = [
  "two_phase",
];

const SETTABLE_OPTIONS: SubscriptionSettableOption[] = [
  "slot_name",
  "binary",
  "streaming",
  "synchronous_commit",
  "disable_on_error",
  "password_required",
  "run_as_owner",
  "origin",
  "failover",
];

export function diffSubscriptions(
  ctx: { currentUser: string },
  main: Record<string, Subscription>,
  branch: Record<string, Subscription>,
): SubscriptionChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);
  const changes: SubscriptionChange[] = [];

  for (const id of created) {
    const subscription = branch[id];
    changes.push(new CreateSubscription({ subscription }));

    // OWNER: If the subscription should be owned by someone other than the current user,
    // emit ALTER SUBSCRIPTION ... OWNER TO after creation
    if (subscription.owner !== ctx.currentUser) {
      changes.push(
        new AlterSubscriptionSetOwner({
          subscription,
          owner: subscription.owner,
        }),
      );
    }

    if (subscription.comment !== null) {
      changes.push(new CreateCommentOnSubscription({ subscription }));
    }
  }

  for (const id of dropped) {
    changes.push(new DropSubscription({ subscription: main[id] }));
  }

  for (const id of altered) {
    const mainSubscription = main[id];
    const branchSubscription = branch[id];

    if (
      hasNonAlterableChanges(
        mainSubscription.dataFields,
        branchSubscription.dataFields,
        NON_ALTERABLE_FIELDS,
      )
    ) {
      changes.push(new DropSubscription({ subscription: mainSubscription }));
      changes.push(
        new CreateSubscription({ subscription: branchSubscription }),
      );
      if (branchSubscription.comment !== null) {
        changes.push(
          new CreateCommentOnSubscription({ subscription: branchSubscription }),
        );
      }
      continue;
    }

    if (mainSubscription.conninfo !== branchSubscription.conninfo) {
      changes.push(
        new AlterSubscriptionSetConnection({
          subscription: branchSubscription,
        }),
      );
    }

    const publicationsChanged =
      mainSubscription.publications.length !==
        branchSubscription.publications.length ||
      mainSubscription.publications.some(
        (pub, index) => pub !== branchSubscription.publications[index],
      );

    if (publicationsChanged) {
      changes.push(
        new AlterSubscriptionSetPublication({
          subscription: branchSubscription,
        }),
      );
    }

    if (mainSubscription.enabled !== branchSubscription.enabled) {
      if (branchSubscription.enabled) {
        changes.push(
          new AlterSubscriptionEnable({ subscription: branchSubscription }),
        );
      } else {
        changes.push(
          new AlterSubscriptionDisable({ subscription: branchSubscription }),
        );
      }
    }

    const optionKeys: SubscriptionSettableOption[] = [];
    for (const option of SETTABLE_OPTIONS) {
      switch (option) {
        case "slot_name": {
          if (
            mainSubscription.slot_is_none !== branchSubscription.slot_is_none ||
            mainSubscription.slot_name !== branchSubscription.slot_name
          ) {
            optionKeys.push(option);
          }
          break;
        }
        case "binary": {
          if (mainSubscription.binary !== branchSubscription.binary) {
            optionKeys.push(option);
          }
          break;
        }
        case "streaming": {
          if (mainSubscription.streaming !== branchSubscription.streaming) {
            optionKeys.push(option);
          }
          break;
        }
        case "synchronous_commit": {
          if (
            mainSubscription.synchronous_commit !==
            branchSubscription.synchronous_commit
          ) {
            optionKeys.push(option);
          }
          break;
        }
        case "disable_on_error": {
          if (
            mainSubscription.disable_on_error !==
            branchSubscription.disable_on_error
          ) {
            optionKeys.push(option);
          }
          break;
        }
        case "password_required": {
          if (
            mainSubscription.password_required !==
            branchSubscription.password_required
          ) {
            optionKeys.push(option);
          }
          break;
        }
        case "run_as_owner": {
          if (
            mainSubscription.run_as_owner !== branchSubscription.run_as_owner
          ) {
            optionKeys.push(option);
          }
          break;
        }
        case "origin": {
          if (mainSubscription.origin !== branchSubscription.origin) {
            optionKeys.push(option);
          }
          break;
        }
        case "failover": {
          if (mainSubscription.failover !== branchSubscription.failover) {
            optionKeys.push(option);
          }
          break;
        }
        default: {
          const _exhaustive: never = option;
          void _exhaustive;
        }
      }
    }

    if (optionKeys.length > 0) {
      changes.push(
        new AlterSubscriptionSetOptions({
          subscription: branchSubscription,
          options: optionKeys,
        }),
      );
    }

    if (mainSubscription.owner !== branchSubscription.owner) {
      changes.push(
        new AlterSubscriptionSetOwner({
          subscription: branchSubscription,
          owner: branchSubscription.owner,
        }),
      );
    }

    if (mainSubscription.comment !== branchSubscription.comment) {
      if (branchSubscription.comment === null) {
        if (mainSubscription.comment !== null) {
          changes.push(
            new DropCommentOnSubscription({ subscription: mainSubscription }),
          );
        }
      } else {
        changes.push(
          new CreateCommentOnSubscription({
            subscription: branchSubscription,
          }),
        );
      }
    }
  }

  return changes;
}
