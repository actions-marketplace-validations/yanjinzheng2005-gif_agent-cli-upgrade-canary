# Validation

This file records reproducible evidence for the current release candidate.

## Controlled fixtures

- `npm test`: 7/7 tests passed.
- Known bad upgrade: baseline `1.0.0` contains `command-logger`; candidate `2.0.0` removes it. Verdict: `REGRESSION`, exact failed contract: `hooks`.
- Known good upgrade: candidate `2.0.0` preserves version, help, config, required hooks, and `docs` MCP definition. Verdict: `NO_REGRESSION`.
- GitHub Action entrypoint produced `verdict`, JSON path, and Markdown path outputs in an isolated test.
- A parent-process credential-shaped value was injected during E2E; it did not appear in the receipt.
- Temporary run-root paths were replaced with stable `$RUN_ROOT`/state labels in the receipt.

## Real OpenClaw observation

Recorded at `2026-08-17T07:54:27.457Z`:

- Baseline requested/installed: `openclaw@2026.6.33`.
- Candidate requested/installed: `openclaw@2026.7.1-2`.
- Runtime for both: Node `v24.19.0`.
- Both isolated npm installs: `PASS`.
- Baseline: version, help, config validation, required-hook discovery/readiness, and static MCP-definition discovery all `PASS`.
- Candidate: version, help, config validation, required-hook discovery/readiness, and static MCP-definition discovery all `PASS`.
- Required hooks: `boot-md`, `command-logger`, `session-memory`.
- Required unused/static MCP definition: `canary-docs`; both versions found it without connecting to the loopback URL.
- Verdict: `NO_REGRESSION` for the declared contracts.

Committed evidence:

- `validation/results/openclaw-2026-08-17/agent-upgrade-canary-report.json`
- `validation/results/openclaw-2026-08-17/agent-upgrade-canary-report.md`

The first sandboxed attempt could not resolve `registry.npmjs.org`; both installs were correctly classified `UNKNOWN`. The same config was then run with approved npm network access and produced the evidence above. The failed network observation was not treated as a product failure or silently converted to PASS.

## Evidence boundary

Passing fixtures prove the canary's classification logic. They do not prove that any particular OpenClaw upgrade is safe. A real OpenClaw receipt is limited to the recorded package versions, Node runtime, runner OS, isolated config, and declared checks.

The OpenClaw hook result proves discoverability and reported eligibility/loadability only; it does not fire a real gateway hook event. The MCP result proves the saved definition remains discoverable; it does not connect to the endpoint. No model, provider, gateway, channel, or real account was used.

## Public CI

- Repository: <https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary>
- Initial public run: <https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary/actions/runs/32010600903>
- Commit: `7f8569049b81a30b1cbd925ecb642c5161f32937`
- Ubuntu Node 20: PASS
- Ubuntu Node 22: PASS
- Ubuntu Node 24: PASS
- macOS Node 24: PASS
- Windows Node 24: PASS

Every job installed the locked dependencies, audited known vulnerabilities, ran the complete release gate, exercised the bundled Action against the no-regression fixture, and uploaded its receipt artifact.
