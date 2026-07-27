# Maintainers guide

Internal notes for maintaining the pg-toolbelt contribution workflow. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md) for the contributor-facing version.

## The `open-for-contribution` gate

External pull requests are only accepted when they link to an **open** GitHub issue
that carries the **`open-for-contribution`** label. This is enforced by the
[`Contribution Gate`](./workflows/contribution-gate.yml) workflow, whose decision logic
lives in [`scripts/contribution-gate.ts`](./scripts/contribution-gate.ts).

The gate runs **reactively on each PR** via `pull_request_target`
(`opened`/`reopened`/`edited`) so a non-conforming PR is closed right away, and can also
be **swept across every open PR on demand** via the workflow's *Run workflow* button
(`workflow_dispatch`). Both paths only ever run trusted base-branch code with the
repository token: `pull_request_target` checks out the base branch (not the PR head), and
the script only makes GitHub API calls — it never checks out or executes a fork's code.

A pull request is **auto-closed with an explanatory comment** when the author is external
and any of these is true:

- no issue is linked (via a closing keyword such as `Closes #123`, or the PR's
  Development sidebar), or
- the linked issue is closed, or
- the linked issue is missing the `open-for-contribution` label.

Bots, `OWNER`/`MEMBER`/`COLLABORATOR` authors, and authors with effective `admin` or
`write` access are **exempt**. The permission check recognizes private organization
memberships that `author_association` does not expose.

### Running the gate manually

Use **Actions → Contribution Gate → Run workflow** to sweep all open PRs on demand — for
example right after bulk-applying `open-for-contribution` labels, so the whole backlog is
re-evaluated at once instead of waiting for each PR's next edit. Set the **`dry_run`**
input to `true` first to log each PR's decision in the run output without commenting on or
closing anything; run again with `dry_run` unchecked to apply the decisions.

## Triage: applying the label (manual)

During triage:

1. Categorize the issue with one of `✨ Feature`, `🐛 Bug`, `📘 Docs`, or `🛠️ Chore`.
2. When the issue is ready to be worked on, add the **`open-for-contribution`** label.

New issues opened via the templates start with `needs-triage`.

Applying `open-for-contribution` is currently a **manual step** — do it on the GitHub
issue directly (from the GitHub UI, or from the Linear-linked issue).

## Deferred: automatic Linear → GitHub label sync

We considered auto-applying `open-for-contribution` when a Linear issue moves out of
Triage/Backlog (e.g. to Todo). Linear's native GitHub automations are one-directional
(GitHub events update Linear status) and cannot push a GitHub label, so this would need an
external bridge (a scheduled job polling the Linear API, a Zapier/Make zap, or a Linear
webhook → relay). It is **out of scope for now** and tracked separately; until then, apply
the label manually as above.
