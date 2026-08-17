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

test("GitHub Action writes outputs and a receipt", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-canary-action-"));
  const outputFile = path.join(temp, "github-output.txt");
  const reportDir = path.join(temp, "report");
  try {
    await execFileAsync(process.execPath, [path.join(root, "dist/action.cjs")], {
      cwd: root,
      env: {
        ...process.env,
        INPUT_CONFIG: path.join(root, "fixtures/regression.json"),
        INPUT_OUTPUT: reportDir,
        INPUT_FAIL_ON: "never",
        GITHUB_OUTPUT: outputFile
      },
      windowsHide: true
    });
    const outputs = await readFile(outputFile, "utf8");
    assert.match(outputs, /verdict=REGRESSION/);
    assert.match(outputs, /report-json=/);
    const receipt = JSON.parse(await readFile(path.join(reportDir, "agent-upgrade-canary-report.json"), "utf8"));
    assert.equal(receipt.verdict, "REGRESSION");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
