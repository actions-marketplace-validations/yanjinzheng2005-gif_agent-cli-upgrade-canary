import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, validateConfigObject } from "./config.js";
import { exitCodeFor, runCanary, TOOL_VERSION } from "./core.js";
import { writeReports } from "./report.js";

interface ParsedRun {
  config: string;
  output: string;
  failOn: "regression" | "fail" | "never";
  keepWorkdir: boolean;
}

function usage(): string {
  return `Agent CLI Upgrade Canary ${TOOL_VERSION}

Usage:
  agent-upgrade-canary validate --config <file>
  agent-upgrade-canary run --config <file> --output <dir> [--fail-on regression|fail|never] [--keep-workdir]
  agent-upgrade-canary init-openclaw --output <file>
  agent-upgrade-canary --version

The tool never upgrades the user's real CLI. Baseline and candidate run in separate isolated directories.`;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parseRun(args: string[]): ParsedRun {
  const config = option(args, "--config");
  const output = option(args, "--output");
  if (!config) throw new Error("--config is required");
  if (!output) throw new Error("--output is required");
  const failOn = option(args, "--fail-on") ?? "regression";
  if (failOn !== "regression" && failOn !== "fail" && failOn !== "never") throw new Error("--fail-on must be regression, fail, or never");
  return { config, output, failOn, keepWorkdir: args.includes("--keep-workdir") };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(TOOL_VERSION);
    return;
  }
  if (args[0] === "validate") {
    const configPath = option(args, "--config");
    if (!configPath) throw new Error("--config is required");
    const config = await loadConfig(configPath);
    validateConfigObject(config);
    console.log(`Config PASS: ${path.resolve(configPath)}`);
    return;
  }
  if (args[0] === "init-openclaw") {
    const output = option(args, "--output");
    if (!output) throw new Error("--output is required");
    const source = fileURLToPath(new URL("../examples/openclaw.example.json", import.meta.url));
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await copyFile(source, path.resolve(output));
    console.log(`Created ${path.resolve(output)}`);
    return;
  }
  if (args[0] !== "run") throw new Error(`Unknown command: ${args[0]}`);
  const parsed = parseRun(args);
  const config = await loadConfig(parsed.config);
  validateConfigObject(config);
  const receipt = await runCanary(config, { keepWorkdir: parsed.keepWorkdir });
  const reports = await writeReports(receipt, parsed.output);
  console.log(`${receipt.verdict}: ${receipt.summary}`);
  console.log(`JSON: ${reports.jsonPath}`);
  console.log(`Markdown: ${reports.markdownPath}`);
  process.exitCode = exitCodeFor(receipt, parsed.failOn);
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
