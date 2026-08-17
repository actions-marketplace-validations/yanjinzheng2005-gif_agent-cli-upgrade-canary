# Security

## Intended use

Agent CLI Upgrade Canary is a local release-compatibility tester. It is not a vulnerability scanner, exploit framework, credential migrator, malware detector, or production updater.

## Boundaries

- The public V0.1 adapter is fixed to the official `openclaw` npm package.
- Version values accept only exact npm-like versions or known dist-tags; URLs, git specs, file specs, and arbitrary package names are rejected.
- npm lifecycle scripts are disabled with `--ignore-scripts`.
- Probes use fixed argument arrays with `shell: false`.
- Baseline and candidate receive separate state, config, workspace, cache, and temp directories.
- The full parent environment is never inherited. Known token shapes and secret-like JSON values are redacted from receipts.
- The tool does not start a gateway, fire a real hook event, connect to an MCP server, run a model, or call a provider API.

## Remaining risk

The canary executes the published CLI JavaScript for the selected versions. Only use versions from a package and publisher you trust. Isolation reduces accidental state and credential exposure; it is not an OS-level sandbox. For untrusted packages, use a disposable container or VM.

## Reporting

Open a private security advisory in the GitHub repository once the repository is public. Do not include credentials, private configs, or production logs in a public issue.
