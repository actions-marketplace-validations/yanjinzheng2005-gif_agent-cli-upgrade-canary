# Validation

This file records reproducible evidence for the current release candidate.

## Controlled fixtures

- `npm test`: 8/8 tests passed.
- Known bad upgrade: baseline `1.0.0` contains `command-logger`; candidate `2.0.0` removes it but leaves the same name in an unrelated `deprecated` list. Verdict: `REGRESSION`, exact failed contract: `hooks`.
- Known good upgrade: candidate `2.0.0` preserves version, help, config, required hooks, and `docs` MCP definition. Verdict: `NO_REGRESSION`.
- GitHub Action entrypoint produced `verdict`, JSON path, and Markdown path outputs in an isolated test.
- Parent-process credential-shaped values were injected during E2E; the fixture actively exits `91` if either reaches the child. The normal PASS proves the credentials were not inherited, rather than merely redacted afterward.
- Temporary run-root paths were replaced with stable `$RUN_ROOT`/state labels in the receipt.
- The macOS `/var` versus `/private/var` realpath form is covered; no `/private$RUN_ROOT` fragment remains.

## Real OpenClaw observation

Regenerated for v0.1.1 at `2026-08-17T10:13:06.683Z`:

- Baseline requested/installed: `openclaw@2026.6.33`.
- Candidate requested/installed: `openclaw@2026.7.1-2`.
- Runtime for both: Node `v24.19.0`.
- Receipt environment: `darwin` / `arm64`; canary process Node `v25.3.0`.
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

## OpenClaw issue #21488 boundary check

The public issue describes a `2026.2.14` → `2026.2.19-2` upgrade where a non-loopback plaintext WebSocket safety check blocked runtime CLI-to-Gateway operations.

- Both exact npm package versions were installed in isolation.
- Those historical versions predate the current `config validate --json` and `mcp` surfaces, so comparing those unsupported commands produces `FAIL → FAIL`, not a regression.
- Restricting the declared checks to the static commands both versions support (`version`, `help`) produces `NO_REGRESSION`.
- The reported failure requires `status`/Gateway/WebSocket runtime behavior. V0.1.1 deliberately does not start a Gateway or connect to it, so issue #21488 is outside this release's declared evidence boundary.

No red result was manufactured from unsupported commands, and the product scope was not expanded solely to obtain a marketing example.

## Evidence boundary

Passing fixtures prove the canary's classification logic. They do not prove that any particular OpenClaw upgrade is safe. A real OpenClaw receipt is limited to the recorded package versions, Node runtime, runner OS, isolated config, and declared checks.

The OpenClaw hook result proves discoverability and reported eligibility/loadability only; it does not fire a real gateway hook event. The MCP result proves the saved definition remains discoverable; it does not connect to the endpoint. No model, provider, gateway, channel, or real account was used.

## Public CI

- Repository: <https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary>
- Initial public run: <https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary/actions/runs/32010600903>, commit `7f8569049b81a30b1cbd925ecb642c5161f32937`.
- Final main-branch v0.1.0 run: <https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary/actions/runs/32010830149>, commit `e0161bc24dd9cf2c48ed15798f09b42902d0b1dd`.
- v0.1.0 tag run: <https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary/actions/runs/32011013024>, commit `e0161bc24dd9cf2c48ed15798f09b42902d0b1dd`.
- Ubuntu Node 20: PASS
- Ubuntu Node 22: PASS
- Ubuntu Node 24: PASS
- macOS Node 24: PASS
- Windows Node 24: PASS

Every job installed the locked dependencies, audited known vulnerabilities, ran the complete release gate, exercised the bundled Action against the controlled no-regression fixture, and uploaded a `fixture-receipt-*` artifact. These five-platform artifacts are not claims that every job downloaded two real OpenClaw versions.
