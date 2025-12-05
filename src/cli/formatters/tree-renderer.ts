/**
 * Generic tree renderer for hierarchical structures.
 * Uses plain lines style: ├─ and └─
 */

import chalk from "chalk";

const GUIDE_UNIT = "│  ";
const colorCount = (count: string) => chalk.gray(count);
const colorCreate = (n: number) => chalk.green(`${n}`);
const colorAlter = (n: number) => chalk.yellow(`${n}`);
const colorDrop = (n: number) => chalk.red(`${n}`);
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

interface OpCounts {
  create: number;
  alter: number;
  drop: number;
}

function tallyOp(name: string, counts: OpCounts): void {
  if (name.startsWith("+")) counts.create += 1;
  else if (name.startsWith("~")) counts.alter += 1;
  else if (name.startsWith("-")) counts.drop += 1;
}

function summarize(groups?: TreeGroup[], items?: TreeItem[]): OpCounts {
  let counts: OpCounts = { create: 0, alter: 0, drop: 0 };

  const addItem = (name: string) => {
    tallyOp(name, counts);
  };

  items?.forEach((item) => addItem(item.name));
  groups?.forEach((g) => {
    g.items?.forEach((it) => addItem(it.name));
    const child = summarize(g.groups, g.items);
    counts = {
      create: counts.create + child.create,
      alter: counts.alter + child.alter,
      drop: counts.drop + child.drop,
    };
  });

  return counts;
}

function summarizeShallow(groups?: TreeGroup[], items?: TreeItem[]): OpCounts {
  const counts: OpCounts = { create: 0, alter: 0, drop: 0 };

  items?.forEach((item) => tallyOp(item.name, counts));
  groups?.forEach((g) => tallyOp(g.name, counts));

  return counts;
}

function formatCounts(counts: OpCounts): string {
  const parts: string[] = [];
  if (counts.create) parts.push(chalk.green(`+${counts.create}`));
  if (counts.alter) parts.push(chalk.yellow(`~${counts.alter}`));
  if (counts.drop) parts.push(chalk.red(`-${counts.drop}`));
  return parts.length > 0 ? parts.join(" ") : "";
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
  const lines: string[] = [];
  if (root.name) {
    lines.push(chalk.bold(root.name));
  }

  const rootItems = root.items ?? [];
  const rootGroups = root.groups ?? [];

  // Render root items (rare)
  for (let i = 0; i < rootItems.length; i++) {
    const item = rootItems[i];
    const guide = buildGuide(0);
    const coloredName = colorizeName(item.name);
    lines.push(`${guide}${coloredName}`);
  }

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

  for (const group of orderedRoot) {
    renderFlatGroup(group, 0, lines);
  }

  return lines.join("\n");
}

function sortItems(items: TreeItem[]): TreeItem[] {
  return [...items].sort((a, b) => {
    const opOrder = (name: string) =>
      name.startsWith("+")
        ? 0
        : name.startsWith("~")
          ? 1
          : name.startsWith("-")
            ? 2
            : 3;
    const oa = opOrder(a.name);
    const ob = opOrder(b.name);
    if (oa !== ob) return oa - ob;
    const la = a.name.replace(/^[+~-]\s*/, "").toLowerCase();
    const lb = b.name.replace(/^[+~-]\s*/, "").toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    return 0;
  });
}

function sortGroups(groups: TreeGroup[]): TreeGroup[] {
  return [...groups].sort((a, b) => {
    const oa = a.name.startsWith("+")
      ? 0
      : a.name.startsWith("~")
        ? 1
        : a.name.startsWith("-")
          ? 2
          : 3;
    const ob = b.name.startsWith("+")
      ? 0
      : b.name.startsWith("~")
        ? 1
        : b.name.startsWith("-")
          ? 2
          : 3;
    if (oa !== ob) return oa - ob;
    const la = a.name.replace(/^[+~-]\s*/, "").toLowerCase();
    const lb = b.name.replace(/^[+~-]\s*/, "").toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    return 0;
  });
}

/**
 * Colorize a name based on operation symbols (+ ~ -).
 */
function colorizeName(name: string, isGroup = false): string {
  const { base: rawBase, sep, count } = splitNameCount(name);
  const hasOp = /^[+~-]\s/.test(rawBase);
  const baseName = rawBase.trim();

  // Colorize items/entities with operation symbols (e.g., "+ customer", "+ customer_email_domain_idx")
  if (hasOp) {
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
    const padded = hasOp
      ? coloredBase
      : isGroup
        ? coloredBase
        : `  ${coloredBase}`;
    return count ? `${padded}${sep}${colorCount(count)}` : padded;
  }

  const coloredBase = baseName;
  const padded = hasOp
    ? coloredBase
    : isGroup
      ? coloredBase
      : `  ${coloredBase}`;
  return count ? `${padded}${sep}${colorCount(count)}` : padded;
}

/**
 * Render a group with bullet-style indentation.
 */
function renderFlatGroup(
  group: TreeGroup,
  depth: number,
  lines: string[],
): void {
  const guide = buildGuide(depth);
  const { base } = splitNameCount(group.name);
  const hasOp = /^[+~-]\s/.test(base);
  const summary =
    GROUP_NAMES.includes(base) && (group.items || group.groups)
      ? formatCounts(summarizeShallow(group.groups, group.items))
      : "";
  const extraGuide = !hasOp && depth > 0 ? chalk.hex("#4a4a4a")("│ ") : "";
  const coloredName = colorizeName(base, true);
  lines.push(
    summary
      ? `${guide}${extraGuide}${coloredName} ${summary}`
      : `${guide}${extraGuide}${coloredName}`,
  );
  renderChildren(group.items, group.groups, depth + 1, lines);
}

/**
 * Render children of a (already printed) group without printing the group's own line.
 */
function renderChildren(
  items: TreeItem[] | undefined,
  groups: TreeGroup[] | undefined,
  depth: number,
  lines: string[],
): void {
  const hasItems = items && items.length > 0;
  const hasGroups = groups && groups.length > 0;

  if (hasItems && items) {
    const sorted = sortItems(items);
    for (let i = 0; i < sorted.length; i++) {
      const item = items[i];
      const guide = buildGuide(depth);
      const coloredName = colorizeName(sorted[i].name);
      lines.push(`${guide}${coloredName}`);
    }
  }

  if (hasGroups && groups) {
    const sortedGroups = sortGroups(groups);
    for (let i = 0; i < sortedGroups.length; i++) {
      const childGroup = sortedGroups[i];
      renderFlatGroup(childGroup, depth, lines);
    }
  }
}

/**
 * Build a dim vertical guide prefix for alignment.
 */
function buildGuide(depth: number): string {
  if (depth <= 0) return "";
  return chalk.hex("#4a4a4a")(GUIDE_UNIT.repeat(depth));
}
