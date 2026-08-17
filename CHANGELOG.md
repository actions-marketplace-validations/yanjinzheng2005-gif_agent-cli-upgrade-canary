# Changelog

## 0.1.1 - 2026-08-17

- Record platform, architecture, and tool Node version in every receipt.
- Canonicalize macOS temporary paths before redaction.
- Restrict hook and MCP discovery to their explicit result collections.
- Make controlled fixtures fail if parent provider credentials reach the child.
- Make regression and no-regression fixture scripts assert their expected verdicts.
- Tighten version-output matching and clarify public CI/real-package evidence boundaries.
- Rename public CI artifacts to `fixture-receipt-*`.

## 0.1.0 - 2026-08-17

- Add isolated baseline/candidate installs.
- Add OpenClaw version, help, config, hooks, and MCP contract probes.
- Add PASS/FAIL/UNKNOWN evidence semantics and regression classification.
- Add JSON and Markdown receipts.
- Add CLI and GitHub Action entrypoints.
- Add controlled regression and no-regression gold fixtures.
