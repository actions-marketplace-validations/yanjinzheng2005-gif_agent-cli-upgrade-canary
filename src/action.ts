import { appendFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, validateConfigObject } from "./config.js";
import { exitCodeFor, runCanary } from "./core.js";
import { writeReports } from "./report.js";

function input(name: string, fallback?: string): string {
  const value = process.env[`INPUT_${name.replace(/-/g, "_").toUpperCase()}`];
  if (value && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required Action input: ${name}`);
}

async function setOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const configPath = path.resolve(input("config"));
  const output = path.resolve(input("output", "agent-upgrade-canary-output"));
  const failOnInput = input("fail-on", "regression");
  if (failOnInput !== "regression" && failOnInput !== "fail" && failOnInput !== "never") {
    throw new Error("fail-on must be regression, fail, or never");
  }
  const config = await loadConfig(configPath);
  validateConfigObject(config);
  const receipt = await runCanary(config, { keepWorkdir: false });
  const reports = await writeReports(receipt, output);
  await setOutput("verdict", receipt.verdict);
  await setOutput("report-json", reports.jsonPath);
  await setOutput("report-markdown", reports.markdownPath);
  console.log(`${receipt.verdict}: ${receipt.summary}`);
  process.exitCode = exitCodeFor(receipt, failOnInput);
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
