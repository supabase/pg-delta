/**
 * Generic tree renderer for hierarchical structures.
 * Uses plain lines style: ├─ and └─
 */

import chalk from "chalk";

/**
 * A single item in the tree (leaf node).
 */
export interface TreeItem {
  /** The display name/label */
  name: string;
}

/**
 * A group in the tree (branch node with children).
 */
export interface TreeGroup {
  /** The display name/label */
  name: string;
  /** Child items (leaves) */
  items?: TreeItem[];
  /** Child groups (branches) */
  groups?: TreeGroup[];
}

/**
 * Render a tree structure using plain lines style.
 *
 * @example
 * ```ts
 * const tree: TreeGroup = {
 *   name: "root",
 *   groups: [
 *     { name: "src", items: [{ name: "index.ts" }] },
 *     { name: "tests", items: [{ name: "test.ts" }] },
 *   ],
 * };
 * const output = renderTree(tree);
 * // Output:
 * // root
 * // ├─ src
 * // │  └─ index.ts
 * // └─ tests
 * //    └─ test.ts
 * ```
 */
export function renderTree(root: TreeGroup): string {
  const lines: string[] = [];
  // Root name (e.g., "Migration Plan") - bold
  lines.push(chalk.bold(root.name));

  if (root.items || root.groups) {
    renderGroup(root, "", true, lines);
  }

  return lines.join("\n");
}

/**
 * Colorize a name based on operation symbols (+ ~ -).
 */
function colorizeName(name: string): string {
  // Colorize items/entities with operation symbols (e.g., "+ customer", "+ customer_email_domain_idx")
  if (/^[+~-]\s/.test(name)) {
    const symbol = name[0];
    const rest = name.slice(2);
    if (symbol === "+") return `${chalk.green(symbol)} ${rest}`;
    if (symbol === "~") return `${chalk.yellow(symbol)} ${rest}`;
    if (symbol === "-") return `${chalk.red(symbol)} ${rest}`;
  }

  // Group names (like "tables", "schemas") - dim gray
  const baseName = name.replace(/\s*\(\d+\)$/, "");
  const groupNames = [
    "cluster",
    "database",
    "schemas",
    "tables",
    "views",
    "materialized-views",
    "functions",
    "procedures",
    "aggregates",
    "sequences",
    "types",
    "enums",
    "composite-types",
    "ranges",
    "domains",
    "collations",
    "foreign-tables",
    "columns",
    "indexes",
    "triggers",
    "rules",
    "policies",
    "partitions",
    "roles",
    "extensions",
    "event-triggers",
    "publications",
    "subscriptions",
    "foreign-data-wrappers",
    "servers",
    "user-mappings",
  ];

  if (groupNames.includes(baseName)) {
    return chalk.dim(name);
  }

  return name;
}

/**
 * Colorize tree connectors (├─ └─ │).
 */
function colorizeConnector(connector: string): string {
  return chalk.dim(connector);
}

/**
 * Render a group (branch node) and its children.
 */
function renderGroup(
  group: TreeGroup,
  prefix: string,
  isLast: boolean,
  lines: string[],
): void {
  const hasItems = group.items && group.items.length > 0;
  const hasGroups = group.groups && group.groups.length > 0;

  // Render items first
  if (hasItems && group.items) {
    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      const isLastItem = i === group.items.length - 1 && !hasGroups;
      const connector = isLastItem && isLast ? "└─" : "├─";
      const coloredConnector = colorizeConnector(connector);
      const coloredName = colorizeName(item.name);
      const coloredPrefix = colorizePrefix(prefix);
      lines.push(`${coloredPrefix}${coloredConnector} ${coloredName}`);
    }
  }

  // Render groups
  if (hasGroups && group.groups) {
    for (let i = 0; i < group.groups.length; i++) {
      const childGroup = group.groups[i];
      const isLastGroup = i === group.groups.length - 1;
      const connector = isLastGroup && isLast ? "└─" : "├─";
      const childPrefix = isLastGroup && isLast ? "   " : "│  ";
      const coloredConnector = colorizeConnector(connector);
      const coloredPrefix = colorizePrefix(prefix);
      const coloredName = colorizeName(childGroup.name);

      lines.push(`${coloredPrefix}${coloredConnector} ${coloredName}`);

      // Recursively render child group if it has children
      if (childGroup.items || childGroup.groups) {
        renderGroup(
          childGroup,
          prefix + childPrefix,
          isLastGroup && isLast,
          lines,
        );
      }
    }
  }
}

/**
 * Colorize tree prefix (vertical lines).
 */
function colorizePrefix(prefix: string): string {
  return prefix.replace(/│/g, chalk.dim("│"));
}
