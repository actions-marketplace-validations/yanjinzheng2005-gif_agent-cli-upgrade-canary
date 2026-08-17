import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CanaryConfig,
  CanaryReceipt,
  DeltaReceipt,
  ProbeId,
  Status,
  TargetReceipt,
  Verdict,
  RunOptions
} from "./types.js";
import { installTarget } from "./installer.js";
import { runProbes } from "./probes.js";
import { sanitizeProcess, sanitizeValue } from "./redact.js";
import { execute } from "./process.js";

export const TOOL_VERSION = "0.1.1";

function combineStatus(statuses: Status[]): Status {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("UNKNOWN")) return "UNKNOWN";
  return "PASS";
}

function classifyDelta(baseline: Status, candidate: Status): DeltaReceipt["classification"] {
  if (baseline === "PASS" && candidate === "PASS") return "UNCHANGED_PASS";
  if (baseline === "PASS" && candidate === "FAIL") return "REGRESSION";
  if (baseline === "FAIL" && candidate === "PASS") return "RECOVERY";
  if (baseline === "FAIL" && candidate === "FAIL") return "UNCHANGED_FAIL";
  return "INCONCLUSIVE";
}

function createDeltas(baseline: TargetReceipt, candidate: TargetReceipt, checks: ProbeId[]): DeltaReceipt[] {
  const baselineMap = new Map(baseline.probes.map((probe) => [probe.id, probe.status]));
  const candidateMap = new Map(candidate.probes.map((probe) => [probe.id, probe.status]));
  const deltas: DeltaReceipt[] = [
    {
      id: "install",
      baseline: baseline.install.status,
      candidate: candidate.install.status,
      classification: classifyDelta(baseline.install.status, candidate.install.status)
    }
  ];
  for (const id of checks) {
    const baselineStatus = baselineMap.get(id) ?? "UNKNOWN";
    const candidateStatus = candidateMap.get(id) ?? "UNKNOWN";
    deltas.push({ id, baseline: baselineStatus, candidate: candidateStatus, classification: classifyDelta(baselineStatus, candidateStatus) });
  }
  return deltas;
}

function verdictFor(candidate: TargetReceipt, deltas: DeltaReceipt[]): Verdict {
  if (deltas.some((delta) => delta.classification === "REGRESSION")) return "REGRESSION";
  if (candidate.overall === "FAIL") return "CANDIDATE_FAILURE";
  if (candidate.overall === "UNKNOWN" || deltas.some((delta) => delta.classification === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "NO_REGRESSION";
}

function summaryFor(verdict: Verdict, deltas: DeltaReceipt[]): string {
  const regressions = deltas.filter((delta) => delta.classification === "REGRESSION").map((delta) => delta.id);
  if (verdict === "REGRESSION") return `Candidate regressed: ${regressions.join(", ")}`;
  if (verdict === "CANDIDATE_FAILURE") return "Candidate failed one or more declared upgrade contracts";
  if (verdict === "INCONCLUSIVE") return "No regression claim can be made because at least one result is UNKNOWN";
  return "Candidate preserved every declared contract that the baseline passed";
}

async function runtimeVersion(config: CanaryConfig, cwd: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const result = await execute({
    argv: [config.runtime.nodeExecutable, "--version"],
    cwd,
    env,
    timeoutMs: 10_000,
    maxOutputBytes: 10_000
  });
  return result.exitCode === 0 ? result.stdout.trim() || result.stderr.trim() : undefined;
}

async function runTarget(
  config: CanaryConfig,
  label: "baseline" | "candidate",
  runRoot: string,
  replacements: Array<[string, string]>
): Promise<TargetReceipt> {
  const target = config.targets[label];
  const installed = await installTarget(config, label, target, path.join(runRoot, label));
  const runtime = await runtimeVersion(config, installed.workRoot, installed.env);
  const probes = installed.receipt.status === "PASS" ? await runProbes(config, installed) : [];
  const overall = combineStatus([installed.receipt.status, ...probes.map((probe) => probe.status)]);
  const receipt: TargetReceipt = {
    label,
    requestedVersion: target.version,
    ...(installed.receipt.installedVersion ? { installedVersion: installed.receipt.installedVersion } : {}),
    ...(runtime ? { runtimeVersion: runtime } : {}),
    install: installed.receipt,
    probes,
    overall
  };
  if (receipt.install.process) receipt.install.process = sanitizeProcess(receipt.install.process, replacements);
  for (const probe of receipt.probes) probe.process = sanitizeProcess(probe.process, replacements);
  return sanitizeValue(receipt, replacements);
}

export async function runCanary(config: CanaryConfig, options: RunOptions = { keepWorkdir: false }): Promise<CanaryReceipt> {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "agent-upgrade-canary-"));
  const canonicalRunRoot = await realpath(runRoot);
  const replacements: Array<[string, string]> = [
    [runRoot, "$RUN_ROOT"],
    [canonicalRunRoot, "$RUN_ROOT"],
    [path.join(runRoot, "baseline", "state"), "$BASELINE_STATE"],
    [path.join(runRoot, "candidate", "state"), "$CANDIDATE_STATE"],
    [config.runtime.nodeExecutable, "$NODE_RUNTIME"]
  ];
  try {
    const baseline = await runTarget(config, "baseline", runRoot, replacements);
    const candidate = await runTarget(config, "candidate", runRoot, replacements);
    const deltas = createDeltas(baseline, candidate, config.contracts.checks);
    const verdict = verdictFor(candidate, deltas);
    return {
      schemaVersion: "agent-upgrade-canary/receipt-v1",
      toolVersion: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        toolNodeVersion: process.version
      },
      projectName: config.name,
      adapter: config.adapter,
      verdict,
      summary: summaryFor(verdict, deltas),
      baseline,
      candidate,
      deltas,
      boundaries: [
        "Both versions ran in separate temporary state, workspace, npm cache, and config directories.",
        "The parent process environment was reduced to a non-secret allowlist; provider credentials were not inherited.",
        "The canary did not mutate, upgrade, repair, or downgrade the user's real Agent CLI installation.",
        "PASS proves only the contracts declared in this config. UNKNOWN is never converted to PASS."
      ]
    };
  } finally {
    if (!options.keepWorkdir) await rm(runRoot, { recursive: true, force: true });
  }
}

export function exitCodeFor(receipt: CanaryReceipt, failOn: "regression" | "fail" | "never"): number {
  if (failOn === "never") return 0;
  if (failOn === "regression") return receipt.verdict === "REGRESSION" ? 1 : receipt.verdict === "INCONCLUSIVE" ? 2 : 0;
  return receipt.verdict === "NO_REGRESSION" ? 0 : receipt.verdict === "INCONCLUSIVE" ? 2 : 1;
}
