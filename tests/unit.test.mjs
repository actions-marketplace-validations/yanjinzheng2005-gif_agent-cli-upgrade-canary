import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exactVersionObserved, exitCodeFor, loadConfig, redactText, renderMarkdown } from "../dist/library.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("loads the controlled regression config with absolute fixture paths", async () => {
  const config = await loadConfig(path.join(root, "fixtures/regression.json"));
  assert.equal(config.adapter, "fixture");
  assert.equal(config.targets.baseline.version, "1.0.0");
  assert.equal(config.targets.baseline.localPackagePath, path.join(root, "fixtures/baseline"));
});

test("redacts bearer tokens, known token shapes, secret JSON, and run roots", () => {
  const input = 'Bearer abc.def.ghi ghp_1234567890 {"apiKey":"sk_1234567890"} /private/run/file';
  const output = redactText(input, [["/private/run", "$RUN_ROOT"]]);
  assert.equal(output.includes("abc.def.ghi"), false);
  assert.equal(output.includes("ghp_1234567890"), false);
  assert.equal(output.includes("sk_1234567890"), false);
  assert.equal(output.includes("/private/run"), false);
  assert.equal(output.includes("$RUN_ROOT/file"), true);
});

test("exit policy preserves inconclusive as a distinct code", () => {
  const receipt = { verdict: "INCONCLUSIVE" };
  assert.equal(exitCodeFor(receipt, "never"), 0);
  assert.equal(exitCodeFor(receipt, "regression"), 2);
  assert.equal(exitCodeFor(receipt, "fail"), 2);
});

test("markdown names the declared verdict", () => {
  const receipt = {
    schemaVersion: "agent-upgrade-canary/receipt-v1",
    toolVersion: "0.1.0",
    generatedAt: "2026-08-17T00:00:00.000Z",
    environment: { platform: "darwin", arch: "arm64", toolNodeVersion: "v24.19.0" },
    projectName: "fixture",
    adapter: "fixture",
    verdict: "NO_REGRESSION",
    summary: "ok",
    baseline: { label: "baseline", requestedVersion: "1", install: { status: "PASS", requestedVersion: "1", summary: "ok" }, probes: [], overall: "PASS" },
    candidate: { label: "candidate", requestedVersion: "2", install: { status: "PASS", requestedVersion: "2", summary: "ok" }, probes: [], overall: "PASS" },
    deltas: [{ id: "install", baseline: "PASS", candidate: "PASS", classification: "UNCHANGED_PASS" }],
    boundaries: ["bounded"]
  };
  assert.match(renderMarkdown(receipt), /NO_REGRESSION/);
});

test("version matching accepts an exact token but rejects substring lookalikes", () => {
  assert.equal(exactVersionObserved("Fixture Agent 1.0.0", "1.0.0"), true);
  assert.equal(exactVersionObserved("Fixture Agent v1.0.0", "1.0.0"), true);
  assert.equal(exactVersionObserved("Fixture Agent 11.0.0", "1.0.0"), false);
  assert.equal(exactVersionObserved("Fixture Agent 1.0.0-beta.10", "1.0.0-beta.1"), false);
});
