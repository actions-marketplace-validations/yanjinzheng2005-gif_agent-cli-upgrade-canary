import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runFixture(configName, failOn) {
  const output = await mkdtemp(path.join(os.tmpdir(), "agent-canary-e2e-"));
  try {
    const result = await execFileAsync(process.execPath, [
      path.join(root, "dist/cli.js"),
      "run",
      "--config",
      path.join(root, `fixtures/${configName}.json`),
      "--output",
      output,
      "--fail-on",
      failOn
    ], {
      cwd: root,
      env: { ...process.env, OPENAI_API_KEY: "sk_test_should_not_leak_123456" },
      windowsHide: true
    });
    const jsonText = await readFile(path.join(output, "agent-upgrade-canary-report.json"), "utf8");
    return { result, receipt: JSON.parse(jsonText), jsonText };
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

test("known bad candidate is classified as a hook regression", async () => {
  const { receipt, jsonText } = await runFixture("regression", "never");
  assert.equal(receipt.verdict, "REGRESSION");
  assert.equal(receipt.baseline.overall, "PASS");
  assert.equal(receipt.candidate.overall, "FAIL");
  assert.equal(receipt.deltas.find((item) => item.id === "hooks").classification, "REGRESSION");
  assert.equal(jsonText.includes("sk_test_should_not_leak_123456"), false);
  assert.equal(jsonText.includes(os.tmpdir() + path.sep + "agent-upgrade-canary-"), false);
  assert.equal(jsonText.includes(process.execPath), false);
  assert.equal(jsonText.includes("$NODE_RUNTIME"), true);
});

test("known good candidate preserves every declared contract", async () => {
  const { receipt } = await runFixture("pass", "fail");
  assert.equal(receipt.verdict, "NO_REGRESSION");
  assert.equal(receipt.candidate.overall, "PASS");
  assert.equal(receipt.deltas.every((item) => item.classification === "UNCHANGED_PASS"), true);
});
