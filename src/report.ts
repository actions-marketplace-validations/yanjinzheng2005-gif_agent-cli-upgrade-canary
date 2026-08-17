import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanaryReceipt, ProbeReceipt, Status } from "./types.js";

function statusMark(status: Status): string {
  if (status === "PASS") return "✅ PASS";
  if (status === "FAIL") return "❌ FAIL";
  return "⚪ UNKNOWN";
}

function probeRow(id: string, baseline: ProbeReceipt | undefined, candidate: ProbeReceipt | undefined): string {
  return `| ${id} | ${statusMark(baseline?.status ?? "UNKNOWN")} | ${statusMark(candidate?.status ?? "UNKNOWN")} |`;
}

export function renderMarkdown(receipt: CanaryReceipt): string {
  const baselineProbes = new Map(receipt.baseline.probes.map((probe) => [probe.id, probe]));
  const candidateProbes = new Map(receipt.candidate.probes.map((probe) => [probe.id, probe]));
  const lines = [
    "# Agent CLI Upgrade Canary Receipt",
    "",
    `- Verdict: **${receipt.verdict}**`,
    `- Summary: ${receipt.summary}`,
    `- Adapter: ${receipt.adapter}`,
    `- Generated: ${receipt.generatedAt}`,
    `- Environment: ${receipt.environment.platform} / ${receipt.environment.arch} / Node ${receipt.environment.toolNodeVersion}`,
    `- Baseline: ${receipt.baseline.installedVersion ?? receipt.baseline.requestedVersion} (${statusMark(receipt.baseline.overall)})`,
    `- Candidate: ${receipt.candidate.installedVersion ?? receipt.candidate.requestedVersion} (${statusMark(receipt.candidate.overall)})`,
    "",
    "## Contract matrix",
    "",
    "| Contract | Baseline | Candidate |",
    "|---|---|---|",
    `| install | ${statusMark(receipt.baseline.install.status)} | ${statusMark(receipt.candidate.install.status)} |`
  ];
  for (const delta of receipt.deltas.filter((item) => item.id !== "install")) {
    lines.push(probeRow(delta.id, baselineProbes.get(delta.id as ProbeReceipt["id"]), candidateProbes.get(delta.id as ProbeReceipt["id"])));
  }
  lines.push("", "## Deltas", "");
  for (const delta of receipt.deltas) lines.push(`- ${delta.id}: ${delta.baseline} → ${delta.candidate} (${delta.classification})`);
  lines.push("", "## Candidate evidence", "");
  lines.push(`- **install** — ${receipt.candidate.install.status}: ${receipt.candidate.install.summary}`);
  for (const probe of receipt.candidate.probes) lines.push(`- **${probe.id}** — ${probe.status}: ${probe.summary}`);
  lines.push("", "## Evidence boundaries", "");
  for (const boundary of receipt.boundaries) lines.push(`- ${boundary}`);
  lines.push("");
  return lines.join("\n");
}

export async function writeReports(receipt: CanaryReceipt, outputDirectory: string): Promise<{ jsonPath: string; markdownPath: string }> {
  const absoluteOutput = path.resolve(outputDirectory);
  await mkdir(absoluteOutput, { recursive: true });
  const jsonPath = path.join(absoluteOutput, "agent-upgrade-canary-report.json");
  const markdownPath = path.join(absoluteOutput, "agent-upgrade-canary-report.md");
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`),
    writeFile(markdownPath, renderMarkdown(receipt))
  ]);
  return { jsonPath, markdownPath };
}
