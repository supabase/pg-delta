/**
 * Contribution gate: enforces the pg-toolbelt contribution workflow on pull
 * requests opened by external contributors.
 *
 * A PR passes only when it links to an OPEN GitHub issue that carries the
 * `open-for-contribution` label. Members/collaborators/owners and bots are
 * exempt (they work from Linear tickets or automation). PRs that do not follow
 * the process are commented on and closed.
 *
 * Run in CI as: `bun .github/scripts/contribution-gate.ts`
 * The pure `evaluateGate` decision function is unit-tested in
 * `contribution-gate.test.ts`; `main()` performs the GitHub I/O.
 */

export const GATE_LABEL = "open-for-contribution";

/** Author associations treated as internal (exempt from the gate). */
const INTERNAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export interface LinkedIssue {
  /** `owner/name` of the repo the issue lives in (from GraphQL nameWithOwner). */
  repository: string;
  number: number;
  state: "OPEN" | "CLOSED";
  labels: string[];
}

export interface GateInput {
  /** `owner/name` of this repository (from GITHUB_REPOSITORY). */
  repository: string;
  authorAssociation: string;
  isBot: boolean;
  linkedIssues: LinkedIssue[];
}

export type GateReason =
  | "bot"
  | "internal"
  | "ok"
  | "no-linked-issue"
  | "missing-label"
  | "issue-closed";

export interface GateResult {
  pass: boolean;
  reason: GateReason;
  /** Explanatory comment body, present only when `pass` is false. */
  message?: string;
}

const DOCS_FOOTER =
  `\nSee [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md) for the full workflow. ` +
  `Once a maintainer adds the \`${GATE_LABEL}\` label to a linked open issue, ` +
  `reopen or open a new pull request and it will be accepted.`;

function buildMessage(reason: GateReason): string {
  switch (reason) {
    case "no-linked-issue":
      return (
        `👋 Thanks for the contribution! This pull request isn't linked to a ` +
        `tracked issue, so it's being closed automatically.\n\n` +
        `Please open an issue first, wait for a maintainer to add the ` +
        `\`${GATE_LABEL}\` label, then open a pull request that links the issue ` +
        `with a closing keyword (e.g. \`Closes #123\`).${DOCS_FOOTER}`
      );
    case "missing-label":
      return (
        `👋 Thanks! The linked issue hasn't been marked \`${GATE_LABEL}\` yet, ` +
        `so this pull request is being closed automatically.\n\n` +
        `A maintainer adds that label once an issue is triaged and ready to be ` +
        `worked on. Please wait for the label before opening a pull ` +
        `request.${DOCS_FOOTER}`
      );
    case "issue-closed":
      return (
        `👋 The issue linked to this pull request is closed, so it's being ` +
        `closed automatically.\n\n` +
        `Please link an open issue that carries the \`${GATE_LABEL}\` ` +
        `label.${DOCS_FOOTER}`
      );
    default:
      return "";
  }
}

/**
 * Pure decision function for the contribution gate. Given the PR author context
 * and its linked issues, returns whether the PR is allowed and why.
 */
export function evaluateGate(input: GateInput): GateResult {
  if (input.isBot) {
    return { pass: true, reason: "bot" };
  }
  if (INTERNAL_ASSOCIATIONS.has(input.authorAssociation)) {
    return { pass: true, reason: "internal" };
  }

  // Only issues in THIS repository count. A cross-repository closing keyword
  // (e.g. `Closes attacker/repo#1`) links an issue the contributor controls,
  // so it must never satisfy the gate.
  const repo = input.repository.toLowerCase();
  const repoIssues = input.linkedIssues.filter(
    (issue) => issue.repository.toLowerCase() === repo,
  );

  if (repoIssues.length === 0) {
    return {
      pass: false,
      reason: "no-linked-issue",
      message: buildMessage("no-linked-issue"),
    };
  }

  const qualifies = repoIssues.some(
    (issue) => issue.state === "OPEN" && issue.labels.includes(GATE_LABEL),
  );
  if (qualifies) {
    return { pass: true, reason: "ok" };
  }

  const hasOpenIssue = repoIssues.some((issue) => issue.state === "OPEN");
  const reason: GateReason = hasOpenIssue ? "missing-label" : "issue-closed";
  return { pass: false, reason, message: buildMessage(reason) };
}

// --- GitHub I/O (only runs when executed directly) ---

interface GraphQLIssueNode {
  number: number;
  state: "OPEN" | "CLOSED";
  repository: { nameWithOwner: string };
  labels: { nodes: Array<{ name: string }> };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function githubFetch(
  url: string,
  token: string,
  init: Omit<RequestInit, "headers"> = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub request failed (${response.status}) for ${url}: ${body}`,
    );
  }
  return response;
}

async function fetchLinkedIssues(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<LinkedIssue[]> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 20) {
            nodes {
              number
              state
              repository { nameWithOwner }
              labels(first: 50) { nodes { name } }
            }
          }
        }
      }
    }`;
  const response = await githubFetch("https://api.github.com/graphql", token, {
    method: "POST",
    body: JSON.stringify({
      query,
      variables: { owner, repo, number: prNumber },
    }),
  });
  const payload = (await response.json()) as {
    errors?: Array<{ message: string }>;
    data?: {
      repository?: {
        pullRequest?: {
          closingIssuesReferences?: { nodes?: GraphQLIssueNode[] };
        };
      };
    };
  };
  if (payload.errors?.length) {
    throw new Error(
      `GraphQL errors: ${payload.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const nodes =
    payload.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
  return nodes.map((node) => ({
    repository: node.repository.nameWithOwner,
    number: node.number,
    state: node.state,
    labels: node.labels.nodes.map((label) => label.name),
  }));
}

async function main(): Promise<void> {
  const token = requireEnv("GITHUB_TOKEN");
  const repository = requireEnv("GITHUB_REPOSITORY");
  const [owner, repo] = repository.split("/");
  const prNumber = Number(requireEnv("PR_NUMBER"));
  const authorAssociation = process.env.PR_AUTHOR_ASSOCIATION ?? "NONE";
  const isBot = (process.env.PR_AUTHOR_TYPE ?? "User") === "Bot";

  const linkedIssues = await fetchLinkedIssues(token, owner!, repo!, prNumber);
  const result = evaluateGate({
    repository,
    authorAssociation,
    isBot,
    linkedIssues,
  });

  console.log(
    `Contribution gate for PR #${prNumber}: pass=${result.pass} reason=${result.reason} ` +
      `(author_association=${authorAssociation}, bot=${isBot}, linked_issues=${linkedIssues.length})`,
  );

  if (result.pass) {
    return;
  }

  const base = `https://api.github.com/repos/${owner}/${repo}`;
  await githubFetch(`${base}/issues/${prNumber}/comments`, token, {
    method: "POST",
    body: JSON.stringify({ body: result.message }),
  });
  await githubFetch(`${base}/issues/${prNumber}`, token, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
  });
  console.log(`Closed PR #${prNumber} (reason=${result.reason}).`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
