import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterEventTriggerChangeOwner,
  AlterEventTriggerSetEnabled,
} from "./changes/event-trigger.alter.ts";
import {
  CreateCommentOnEventTrigger,
  DropCommentOnEventTrigger,
} from "./changes/event-trigger.comment.ts";
import { CreateEventTrigger } from "./changes/event-trigger.create.ts";
import { DropEventTrigger } from "./changes/event-trigger.drop.ts";
import type { EventTriggerChange } from "./changes/event-trigger.types.ts";
import type { EventTrigger } from "./event-trigger.model.ts";

/**
 * Diff two sets of event triggers from main and branch catalogs.
 *
 * @param ctx - Context containing currentUser
 * @param main - The event triggers in the main catalog.
 * @param branch - The event triggers in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffEventTriggers(
  ctx: { currentUser: string },
  main: Record<string, EventTrigger>,
  branch: Record<string, EventTrigger>,
): EventTriggerChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: EventTriggerChange[] = [];

  for (const eventTriggerId of created) {
    const eventTrigger = branch[eventTriggerId];
    changes.push(new CreateEventTrigger({ eventTrigger }));

    // OWNER: If the event trigger should be owned by someone other than the current user,
    // emit ALTER EVENT TRIGGER ... OWNER TO after creation
    if (eventTrigger.owner !== ctx.currentUser) {
      changes.push(
        new AlterEventTriggerChangeOwner({
          eventTrigger,
          owner: eventTrigger.owner,
        }),
      );
    }

    if (eventTrigger.comment !== null) {
      changes.push(new CreateCommentOnEventTrigger({ eventTrigger }));
    }
  }

  for (const eventTriggerId of dropped) {
    changes.push(new DropEventTrigger({ eventTrigger: main[eventTriggerId] }));
  }

  for (const eventTriggerId of altered) {
    const mainEventTrigger = main[eventTriggerId];
    const branchEventTrigger = branch[eventTriggerId];

    const NON_ALTERABLE_FIELDS: Array<keyof EventTrigger> = [
      "event",
      "function_schema",
      "function_name",
      "tags",
    ];

    const shouldReplace = hasNonAlterableChanges(
      mainEventTrigger,
      branchEventTrigger,
      NON_ALTERABLE_FIELDS,
      { tags: deepEqual },
    );

    if (shouldReplace) {
      changes.push(
        new DropEventTrigger({ eventTrigger: mainEventTrigger }),
        new CreateEventTrigger({ eventTrigger: branchEventTrigger }),
      );
      if (branchEventTrigger.comment !== null) {
        changes.push(
          new CreateCommentOnEventTrigger({
            eventTrigger: branchEventTrigger,
          }),
        );
      }
      continue;
    }

    if (mainEventTrigger.enabled !== branchEventTrigger.enabled) {
      changes.push(
        new AlterEventTriggerSetEnabled({
          eventTrigger: mainEventTrigger,
          enabled: branchEventTrigger.enabled,
        }),
      );
    }

    if (mainEventTrigger.owner !== branchEventTrigger.owner) {
      changes.push(
        new AlterEventTriggerChangeOwner({
          eventTrigger: mainEventTrigger,
          owner: branchEventTrigger.owner,
        }),
      );
    }

    if (mainEventTrigger.comment !== branchEventTrigger.comment) {
      if (branchEventTrigger.comment === null) {
        changes.push(
          new DropCommentOnEventTrigger({
            eventTrigger: mainEventTrigger,
          }),
        );
      } else {
        changes.push(
          new CreateCommentOnEventTrigger({
            eventTrigger: branchEventTrigger,
          }),
        );
      }
    }
  }

  return changes;
}
