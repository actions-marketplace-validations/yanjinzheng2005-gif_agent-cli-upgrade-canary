# Agent CLI Upgrade Canary

[![CI](https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary/actions/workflows/ci.yml/badge.svg)](https://github.com/yanjinzheng2005-gif/agent-cli-upgrade-canary/actions/workflows/ci.yml)

Test an Agent CLI upgrade in isolation before it touches the real installation.

The canary installs a baseline and a candidate in separate temporary prefixes, gives each version its own OpenClaw state/config/workspace/npm cache, runs the same declared static/read-only contracts, and writes a JSON plus Markdown receipt.

It answers a narrow question:

> Did this candidate preserve the startup, config, hooks, and MCP contracts that the baseline passed?

It does **not** upgrade, repair, downgrade, or modify the user's real Agent CLI installation.

## Why

An Agent CLI can still print a version after an upgrade while required hooks become undiscoverable or ineligible, MCP definitions disappear, or the old config no longer validates. Release notes and `update --dry-run` describe the planned update; they do not execute both versions against the user's declared static contracts.

## Status

V0.1 supports one public adapter, OpenClaw, plus a maintainers-only local fixture adapter used to prove the result semantics without network access. The public CI repeats the release checks on Ubuntu Node 20/22/24, macOS Node 24, and Windows Node 24.

## Quick start

Requirements:

- Node.js 20+ to run the canary itself.
- A Node.js runtime supported by the Agent CLI under test. Current OpenClaw releases require Node 22.22.3+ or Node 24.15+; set `runtime.nodeExecutable` when the default `node` is older.
- npm on `PATH` for the OpenClaw adapter.

```bash
npm ci
npm run build
cp examples/openclaw.example.json openclaw-canary.json
node dist/cli.js run \
  --config openclaw-canary.json \
  --output canary-output \
  --fail-on regression
```

Reports:

- `canary-output/agent-upgrade-canary-report.json`
- `canary-output/agent-upgrade-canary-report.md`

## Config

```json
{
  "$schema": "./schema/agent-upgrade-canary.schema.json",
  "schemaVersion": "agent-upgrade-canary/v1",
  "name": "OpenClaw extended-stable to latest",
  "adapter": "openclaw",
  "targets": {
    "baseline": { "version": "2026.6.33" },
    "candidate": { "version": "2026.7.1-2" }
  },
  "contracts": {
    "checks": ["version", "help", "config", "hooks", "mcp"],
    "requiredHooks": ["boot-md", "command-logger", "session-memory"],
    "requiredMcpServers": ["canary-docs"]
  },
  "openclawConfig": {
    "gateway": { "mode": "local" },
    "mcp": {
      "servers": {
        "canary-docs": {
          "url": "http://127.0.0.1:9/mcp",
          "transport": "streamable-http"
        }
      }
    }
  }
}
```

Use exact versions for reproducible receipts. Dist-tags are accepted for exploration but can move later.

## Result semantics

- `PASS`: the command completed and the declared contract was observed.
- `FAIL`: the command or declared contract failed.
- `UNKNOWN`: timeout, spawn failure, or transient install/network failure prevented a reliable observation.

`UNKNOWN` is never converted to `PASS`.

Verdicts:

- `NO_REGRESSION`: every declared contract passed on the candidate and no baseline PASS became candidate FAIL.
- `REGRESSION`: at least one baseline PASS became candidate FAIL.
- `CANDIDATE_FAILURE`: the candidate failed, but the baseline did not prove a clean regression edge.
- `INCONCLUSIVE`: at least one required result remained UNKNOWN.

## Isolation boundary

For every version, the canary creates separate directories for:

- install prefix;
- OpenClaw home/state/config/workspace;
- npm cache and user config;
- temporary files.

Only a small non-secret parent environment allowlist is inherited. Provider/API credentials are not forwarded. npm lifecycle scripts are disabled during package installation. Probes are fixed argument arrays and run without a shell.

The OpenClaw adapter runs only read-only surfaces:

- `--version`
- `--help`
- `config validate --json`
- `hooks list --json`
- `mcp list --json` (with a static-status fallback for older CLI shapes)

The hooks probe proves that required hooks are discoverable and not reported as disabled, ineligible, unloadable, or missing requirements. It does not start a gateway or prove delivery of a real hook event.

The bundled OpenClaw example declares an unused loopback fixture named `canary-docs`. `mcp list` is a static read and does not connect to it; the check proves only that the saved server definition remains discoverable across the two versions.

## GitHub Action

```yaml
- uses: yanjinzheng2005-gif/agent-cli-upgrade-canary@v0.1.0
  with:
    config: examples/openclaw.example.json
    output: agent-upgrade-canary-output
    fail-on: regression

- uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  if: always()
  with:
    name: agent-upgrade-canary-receipt
    path: agent-upgrade-canary-output
```

The Action exposes `verdict`, `report-json`, and `report-markdown` outputs.

## Controlled proof fixtures

```bash
npm run fixture:regression
npm run fixture:pass
```

The regression fixture intentionally removes `command-logger` from the candidate. The pass fixture preserves every required hook. These fixtures prove the canary can distinguish a known bad upgrade from a known good one without relying on a third-party service.

## Evidence boundary

A green receipt is not a general statement that an Agent CLI is bug-free or that its model behavior is unchanged. It proves only the contracts declared in the config, on the recorded runner and versions, at the recorded time.

## License

Apache-2.0.
