# CLI and usability improvements

## Summary

Improve CLI ergonomics: better flags, help, interactive prompts (optional), clearer output.

- Related migra issues:
  - [migra#227: Command-line interface improvements](https://github.com/djrobstep/migra/issues/227)
  - [migra#240: Add interactive prompts for migration decisions](https://github.com/djrobstep/migra/issues/240)
  - [migra#243: Output readability improvements](https://github.com/djrobstep/migra/issues/243)

## Acceptance tests (manual + unit)

- `--help` shows clear grouped options; invalid flag shows actionable message.
- Optional `--interactive` gates any prompt; default remains non-interactive.
- Output formatted with sections and summaries.

## pg-diff analysis (feature vs test)

- Status: Feature request.
- Action: Define CLI option set, update README, add unit tests for arg parsing.
