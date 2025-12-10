/**
 * Generic tree renderer for hierarchical structures.
 * Uses dim guides and connectors (├/└) with no trailing rails past last children.
 * Helper names favor readability over brevity.
 */

import chalk from "chalk";

const GUIDE_UNIT = "│  ";
const colorCount = (count: string) => chalk.gray(count);
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");
const visibleWidth = (value: string) => stripAnsi(value).length;
const splitNameCount = (name: string) => {
  const m = name.match(/^(.*?)(\s+)(\d+)$/);
  return m
    ? { base: m[1], sep: m[2], count: m[3] }
    : { base: name, sep: "", count: "" };
};
const GROUP_NAMES = [
  "cluster",
  "database",
  "schemas",
  "tables",
  "views",
  "materialized views",
  "functions",
  "procedures",
  "aggregates",
  "sequences",
  "types",
  "enums",
  "composite types",
  "ranges",
  "domains",
  "collations",
  "foreign tables",
  "columns",
  "indexes",
  "triggers",
  "rules",
  "policies",
  "partitions",
  "roles",
  "extensions",
  "event triggers",
  "publications",
  "subscriptions",
  "foreign data wrappers",
  "servers",
  "user mappings",
];

interface OperationCounts {
  create: number;
  alter: number;
  drop: number;
}

/**
 * Increment operation counters based on a prefixed label.
 */
function tallyOperation(name: string, counts: OperationCounts): void {
  if (name.startsWith("+")) counts.create += 1;
  else if (name.startsWith("~")) counts.alter += 1;
  else if (name.startsWith("-")) counts.drop += 1;
}

/**
 * Count operations for a single level (no recursion).
 */
function summarizeShallow(
  groups?: TreeGroup[],
  items?: TreeItem[],
): OperationCounts {
  const counts: OperationCounts = { create: 0, alter: 0, drop: 0 };

  if (items) {
    for (const item of items) {
      tallyOperation(item.name, counts);
    }
  }
  if (groups) {
    for (const group of groups) {
      tallyOperation(group.name, counts);
    }
  }

  return counts;
}

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
  interface TreeRow {
    left: string;
    counts?: OperationCounts;
  }
  const rows: TreeRow[] = [];
  if (root.name) {
    rows.push({ left: chalk.bold(root.name) });
  }

  const rootItems = root.items ?? [];
  const rootGroups = root.groups ?? [];

  // Render root groups at top level (no extra wrapper indentation)
  const clusterEntries: TreeGroup[] = [];
  const otherGroups: TreeGroup[] = [];
  let schemasGroup: TreeGroup | undefined;

  for (const group of rootGroups) {
    const { base: label } = splitNameCount(group.name);
    if (label === "cluster") {
      if (group.items) {
        clusterEntries.push(...group.items.map((it) => ({ name: it.name })));
      }
      if (group.groups) {
        clusterEntries.push(...group.groups);
      }
    } else if (label === "schemas") {
      schemasGroup = group;
    } else {
      otherGroups.push(group);
    }
  }

  const orderedRoot: TreeGroup[] = [
    ...sortGroups(clusterEntries),
    ...(schemasGroup ? [schemasGroup] : []),
    ...sortGroups(otherGroups),
  ];

  const combinedRoot = [
    ...sortItems(rootItems).map((it) => ({
      kind: "item" as const,
      name: it.name,
    })),
    ...orderedRoot.map((g) => ({ kind: "group" as const, group: g })),
  ];

  for (let i = 0; i < combinedRoot.length; i++) {
    const node = combinedRoot[i];
    const isLast = i === combinedRoot.length - 1;
    if (node.kind === "item") {
      renderItem(node.name, [], isLast, rows);
    } else {
      renderGroup(node.group, [], isLast, rows);
    }
  }

  const maxLeftWidth = rows.reduce(
    (max, row) => Math.max(max, visibleWidth(row.left)),
    0,
  );

  const maxColumnWidths: Record<keyof OperationCounts, number> = {
    create: 0,
    alter: 0,
    drop: 0,
  };

  for (const row of rows) {
    const counts = row.counts;
    if (!counts) continue;
    if (counts.create) {
      const width = visibleWidth(`+${counts.create}`);
      if (width > maxColumnWidths.create) maxColumnWidths.create = width;
    }
    if (counts.alter) {
      const width = visibleWidth(`~${counts.alter}`);
      if (width > maxColumnWidths.alter) maxColumnWidths.alter = width;
    }
    if (counts.drop) {
      const width = visibleWidth(`-${counts.drop}`);
      if (width > maxColumnWidths.drop) maxColumnWidths.drop = width;
    }
  }

  const hasAnyColumn = Object.values(maxColumnWidths).some(
    (width) => width > 0,
  );

  const formatColumn = (
    value: number | undefined,
    width: number,
    symbol: "+" | "~" | "-",
    colorize: (value: string) => string,
  ): string => {
    if (width === 0) return "";
    if (!value) {
      const leftPad = Math.min(
        Math.max(1, Math.floor((width - 1) / 2) + 1),
        width - 1,
      );
      const rightPad = width - 1 - leftPad;
      return `${" ".repeat(leftPad)}${colorize("·")}${" ".repeat(rightPad)}`;
    }
    const raw = `${symbol}${value}`;
    const padding = width - visibleWidth(raw);
    return `${" ".repeat(Math.max(0, padding))}${colorize(raw)}`;
  };

  const lines = rows.map(({ left, counts }) => {
    const gap = Math.max(0, maxLeftWidth - visibleWidth(left));
    const filler =
      counts && gap > 0
        ? ` ${chalk.hex("#4a4a4a")("─".repeat(Math.max(0, gap - 1)))}`
        : " ".repeat(gap);
    const paddedLeft = `${left}${filler}`;

    if (!hasAnyColumn || !counts) return paddedLeft;

    const createCol = formatColumn(
      counts.create,
      maxColumnWidths.create,
      "+",
      (value) => chalk.green.dim(value),
    );
    const alterCol = formatColumn(
      counts.alter,
      maxColumnWidths.alter,
      "~",
      (value) => chalk.yellow.dim(value),
    );
    const dropCol = formatColumn(
      counts.drop,
      maxColumnWidths.drop,
      "-",
      (value) => chalk.red.dim(value),
    );

    const renderedColumns = [createCol, alterCol, dropCol].filter(
      (col) => col !== "",
    );

    return renderedColumns.length > 0
      ? `${paddedLeft} ${renderedColumns.join(" ")}`
      : paddedLeft;
  });

  return lines.join("\n");
}

function sortItems(items: TreeItem[]): TreeItem[] {
  return [...items].sort((firstItem, secondItem) => {
    const operationOrder = (name: string) =>
      name.startsWith("+")
        ? 0
        : name.startsWith("~")
          ? 1
          : name.startsWith("-")
            ? 2
            : 3;
    const firstOrder = operationOrder(firstItem.name);
    const secondOrder = operationOrder(secondItem.name);
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    const firstLabel = firstItem.name.replace(/^[+~-]\s*/, "").toLowerCase();
    const secondLabel = secondItem.name.replace(/^[+~-]\s*/, "").toLowerCase();
    if (firstLabel < secondLabel) return -1;
    if (firstLabel > secondLabel) return 1;
    return 0;
  });
}

function sortGroups(groups: TreeGroup[]): TreeGroup[] {
  return [...groups].sort((firstGroup, secondGroup) => {
    const operationOrder = (name: string) =>
      name.startsWith("+")
        ? 0
        : name.startsWith("~")
          ? 1
          : name.startsWith("-")
            ? 2
            : 3;
    const firstOrder = operationOrder(firstGroup.name);
    const secondOrder = operationOrder(secondGroup.name);
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    const firstLabel = firstGroup.name.replace(/^[+~-]\s*/, "").toLowerCase();
    const secondLabel = secondGroup.name.replace(/^[+~-]\s*/, "").toLowerCase();
    if (firstLabel < secondLabel) return -1;
    if (firstLabel > secondLabel) return 1;
    return 0;
  });
}

/**
 * Colorize a label; pads non-op labels to align with op-labeled rows.
 */
function colorizeName(name: string, isGroup = false): string {
  const { base: rawBase, sep, count } = splitNameCount(name);
  const hasOperationSymbol = /^[+~-]\s/.test(rawBase);
  const baseName = rawBase.trim();

  // Colorize items/entities with operation symbols (e.g., "+ customer", "+ customer_email_domain_idx")
  if (hasOperationSymbol) {
    const symbol = rawBase[0];
    const rest = rawBase.slice(2).trimStart();
    const coloredBase =
      symbol === "+"
        ? `${chalk.green(symbol)} ${rest}`
        : symbol === "~"
          ? `${chalk.yellow(symbol)} ${rest}`
          : `${chalk.red(symbol)} ${rest}`;
    return count ? `${coloredBase}${sep}${colorCount(count)}` : coloredBase;
  }

  // Group names (like "tables", "schemas") - dim gray
  const baseNameStripped = baseName.replace(/\s*\(\d+\)$/, "");

  if (GROUP_NAMES.includes(baseNameStripped)) {
    const coloredBase = chalk.gray(baseNameStripped);
    return count ? `${coloredBase}${sep}${colorCount(count)}` : coloredBase;
  }

  const padded = isGroup ? baseName : `  ${baseName}`;
  return count ? `${padded}${sep}${colorCount(count)}` : padded;
}

/**
 * Render a group with bullet-style indentation.
 */
function buildPrefix(ancestors: boolean[]): string {
  return ancestors
    .map((hasSibling) =>
      hasSibling ? chalk.hex("#4a4a4a")(GUIDE_UNIT) : "   ",
    )
    .join("");
}

/**
 * Render a group node (may have child groups/items). Avoids drawing guides past the last child.
 */
function renderGroup(
  group: TreeGroup,
  ancestors: boolean[],
  isLast: boolean,
  rows: { left: string; counts?: OperationCounts }[],
): void {
  const { base } = splitNameCount(group.name);
  const hasOperationSymbol = /^[+~-]\s/.test(base);
  const baseNormalized = base
    .replace(/^[+~-]\s*/, "")
    .replace(/\s*\(\d+\)$/, "");
  const summary =
    GROUP_NAMES.includes(base) &&
    baseNormalized !== "types" &&
    (group.items || group.groups)
      ? summarizeShallow(group.groups, group.items)
      : undefined;
  const childItems = sortItems(group.items ?? []);
  const childGroups = sortGroups(group.groups ?? []);
  const children = [
    ...childItems.map((item) => ({ kind: "item" as const, name: item.name })),
    ...childGroups.map((childGroup) => ({
      kind: "group" as const,
      group: childGroup,
    })),
  ];

  const prefix = buildPrefix(ancestors);
  const connector = chalk.hex("#4a4a4a")(isLast ? "└ " : "├ ");
  const extraGuide = hasOperationSymbol ? "" : connector;
  const coloredName = colorizeName(base, true);
  rows.push({
    left: `${prefix}${extraGuide}${coloredName}`,
    counts: summary,
  });

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIsLast = i === children.length - 1;
    const childAncestors = [...ancestors, !isLast];
    if (child.kind === "item") {
      renderItem(child.name, childAncestors, childIsLast, rows);
    } else {
      renderGroup(child.group, childAncestors, childIsLast, rows);
    }
  }
}

/**
 * Render a leaf item. Non-op rows get a dim connector; op rows start at the prefix.
 */
function renderItem(
  name: string,
  ancestors: boolean[],
  isLast: boolean,
  rows: { left: string; count?: string }[],
): void {
  const prefix = buildPrefix(ancestors);
  const hasOperationSymbol = /^[+~-]\s/.test(name);
  const connector = hasOperationSymbol
    ? ""
    : chalk.hex("#4a4a4a")(isLast ? "└ " : "├ ");
  const coloredName = colorizeName(name);
  rows.push({ left: `${prefix}${connector}${coloredName}` });
}
