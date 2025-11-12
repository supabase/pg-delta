import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import {
  formatSubscriptionOption,
  type SubscriptionSettableOption,
} from "../utils.ts";
import { AlterSubscriptionChange } from "./subscription.base.ts";

export class AlterSubscriptionSetConnection extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} CONNECTION ${quoteLiteral(this.subscription.conninfo)}`;
  }
}

export class AlterSubscriptionSetPublication extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    const base = `ALTER SUBSCRIPTION ${this.subscription.name} SET PUBLICATION ${this.subscription.publications.join(", ")}`;
    if (!this.subscription.enabled) {
      return `${base} WITH (refresh = false)`;
    }
    return base;
  }
}

export class AlterSubscriptionEnable extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} ENABLE`;
  }
}

export class AlterSubscriptionDisable extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} DISABLE`;
  }
}

export class AlterSubscriptionSetOptions extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;
  private readonly options: SubscriptionSettableOption[];

  constructor(props: {
    subscription: Subscription;
    options: SubscriptionSettableOption[];
  }) {
    super();
    this.subscription = props.subscription;
    this.options = props.options;
  }

  serialize(): string {
    const assignments = this.options.map((option) =>
      formatSubscriptionOption(this.subscription, option),
    );
    return `ALTER SUBSCRIPTION ${this.subscription.name} SET (${assignments.join(", ")})`;
  }
}

export class AlterSubscriptionSetOwner extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;
  public readonly owner: string;

  constructor(props: { subscription: Subscription; owner: string }) {
    super();
    this.subscription = props.subscription;
    this.owner = props.owner;
  }

  get requires() {
    return [stableId.role(this.owner)];
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} OWNER TO ${this.owner}`;
  }
}
