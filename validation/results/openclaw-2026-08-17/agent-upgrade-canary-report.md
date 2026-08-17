# Agent CLI Upgrade Canary Receipt

- Verdict: **NO_REGRESSION**
- Summary: Candidate preserved every declared contract that the baseline passed
- Adapter: openclaw
- Generated: 2026-08-17T08:08:26.021Z
- Baseline: 2026.6.33 (✅ PASS)
- Candidate: 2026.7.1-2 (✅ PASS)

## Contract matrix

| Contract | Baseline | Candidate |
|---|---|---|
| install | ✅ PASS | ✅ PASS |
| version | ✅ PASS | ✅ PASS |
| help | ✅ PASS | ✅ PASS |
| config | ✅ PASS | ✅ PASS |
| hooks | ✅ PASS | ✅ PASS |
| mcp | ✅ PASS | ✅ PASS |

## Deltas

- install: PASS → PASS (UNCHANGED_PASS)
- version: PASS → PASS (UNCHANGED_PASS)
- help: PASS → PASS (UNCHANGED_PASS)
- config: PASS → PASS (UNCHANGED_PASS)
- hooks: PASS → PASS (UNCHANGED_PASS)
- mcp: PASS → PASS (UNCHANGED_PASS)

## Candidate evidence

- **version** — PASS: CLI reports installed version 2026.7.1-2
- **help** — PASS: CLI help starts without credentials
- **config** — PASS: Config validates against the installed CLI schema
- **hooks** — PASS: Required hooks are discoverable and eligible in this isolated config
- **mcp** — PASS: Required MCP definitions remain discoverable without connecting to them

## Evidence boundaries

- Both versions ran in separate temporary state, workspace, npm cache, and config directories.
- The parent process environment was reduced to a non-secret allowlist; provider credentials were not inherited.
- The canary did not mutate, upgrade, repair, or downgrade the user's real Agent CLI installation.
- PASS proves only the contracts declared in this config. UNKNOWN is never converted to PASS.
