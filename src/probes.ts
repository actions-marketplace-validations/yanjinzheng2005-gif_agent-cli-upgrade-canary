import type { CanaryConfig, ProbeId, ProbeReceipt, ProcessResult, Status } from "./types.js";
import type { InstalledTarget } from "./installer.js";
import { execute, processPassed } from "./process.js";

function statusForProcess(result: ProcessResult): Status {
  if (result.timedOut || result.spawnError) return "UNKNOWN";
  return processPassed(result) ? "PASS" : "FAIL";
}

function combinedOutput(result: ProcessResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function parseJsonOutput(result: ProcessResult): unknown {
  const text = combinedOutput(result).trim();
  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.indexOf("{");
    const arrayStart = text.indexOf("[");
    const startCandidates = [objectStart, arrayStart].filter((value) => value >= 0);
    if (startCandidates.length === 0) throw new Error("command did not return JSON");
    const start = Math.min(...startCandidates);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (end < start) throw new Error("command returned incomplete JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function hookRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const hooks = Array.isArray(value) ? value : record.hooks;
  if (!Array.isArray(hooks)) return [];
  return hooks.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function hookNames(value: unknown): Set<string> {
  const names = new Set<string>();
  for (const record of hookRecords(value)) {
    const name = [record.key, record.name, record.id].find((candidate) => typeof candidate === "string");
    if (typeof name === "string") names.add(name);
  }
  return names;
}

function mcpNames(value: unknown): Set<string> {
  const names = new Set<string>();
  if (!value || typeof value !== "object") return names;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const name = [record.name, record.id, record.serverName].find((candidate) => typeof candidate === "string");
      if (typeof name === "string") names.add(name);
    }
    return names;
  }
  const record = value as Record<string, unknown>;
  const servers = record.servers;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    for (const key of Object.keys(servers as Record<string, unknown>)) names.add(key);
  } else {
    for (const key of Object.keys(record)) names.add(key);
  }
  return names;
}

function unreadyHooks(value: unknown, requiredNames: string[]): string[] {
  const readiness = new Map(requiredNames.map((name) => [name, false]));
  for (const record of hookRecords(value)) {
    const name = [record.key, record.name, record.id].find((candidate) => typeof candidate === "string") as string | undefined;
    if (name && readiness.has(name)) {
      const ready = record.eligible !== false && record.requirementsSatisfied !== false && record.loadable !== false && record.disabled !== true;
      if (ready) readiness.set(name, true);
    }
  }
  return [...readiness.entries()].filter(([, ready]) => !ready).map(([name]) => name);
}

export function exactVersionObserved(output: string, expected: string): boolean {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9A-Za-z.+_-])v?${escaped}(?![0-9A-Za-z.+_-])`).test(output);
}

async function runCommand(config: CanaryConfig, installed: InstalledTarget, args: string[]): Promise<ProcessResult> {
  if (!installed.executable) {
    return {
      argv: [config.runtime.nodeExecutable, "<missing executable>", ...args],
      cwd: installed.workRoot,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      truncated: false,
      durationMs: 0,
      spawnError: "Target executable is unavailable because installation did not pass"
    };
  }
  return await execute({
    argv: [config.runtime.nodeExecutable, installed.executable, ...args],
    cwd: installed.workRoot,
    env: installed.env,
    timeoutMs: config.runtime.probeTimeoutMs,
    maxOutputBytes: config.runtime.maxOutputBytes
  });
}

async function versionProbe(config: CanaryConfig, installed: InstalledTarget): Promise<ProbeReceipt> {
  const process = await runCommand(config, installed, ["--version"]);
  let status = statusForProcess(process);
  const expected = installed.receipt.installedVersion;
  if (status === "PASS" && expected && !exactVersionObserved(combinedOutput(process), expected)) status = "FAIL";
  return {
    id: "version",
    status,
    summary: status === "PASS" ? `CLI reports installed version ${expected}` : `CLI version output did not prove installed version ${expected ?? "unknown"}`,
    observed: { expectedVersion: expected, output: combinedOutput(process) },
    process
  };
}

async function helpProbe(config: CanaryConfig, installed: InstalledTarget): Promise<ProbeReceipt> {
  const process = await runCommand(config, installed, ["--help"]);
  let status = statusForProcess(process);
  if (status === "PASS" && combinedOutput(process).length < 20) status = "FAIL";
  return { id: "help", status, summary: status === "PASS" ? "CLI help starts without credentials" : "CLI help did not produce a usable response", process };
}

async function jsonProbe(
  id: "config" | "hooks" | "mcp",
  config: CanaryConfig,
  installed: InstalledTarget,
  args: string[],
  requiredNames: string[]
): Promise<ProbeReceipt> {
  let process = await runCommand(config, installed, args);
  if (id === "mcp" && !processPassed(process) && /unknown (?:option|command)|unrecognized/i.test(combinedOutput(process))) {
    process = await runCommand(config, installed, ["mcp", "status", "--json"]);
  }
  let status = statusForProcess(process);
  let observed: unknown;
  let summary: string;
  if (status === "PASS") {
    try {
      observed = parseJsonOutput(process);
      const names = id === "hooks" ? hookNames(observed) : id === "mcp" ? mcpNames(observed) : new Set<string>();
      const missing = requiredNames.filter((name) => !names.has(name));
      const unready = id === "hooks" ? unreadyHooks(observed, requiredNames.filter((name) => names.has(name))) : [];
      if (id === "config" && observed && typeof observed === "object") {
        const record = observed as Record<string, unknown>;
        if (record.ok === false || record.valid === false) status = "FAIL";
      }
      if (missing.length > 0 || unready.length > 0) status = "FAIL";
      if (status === "PASS" && id === "hooks") summary = "Required hooks are discoverable and eligible in this isolated config";
      else if (status === "PASS" && id === "mcp") summary = "Required MCP definitions remain discoverable without connecting to them";
      else if (status === "PASS") summary = "Config validates against the installed CLI schema";
      else summary = `${id} contract failed; missing: ${missing.join(", ") || "none"}; unready: ${unready.join(", ") || "none"}`;
      observed = { value: observed, discoveredNames: [...names].sort(), missing, unready };
    } catch (error) {
      status = "FAIL";
      summary = `${id} command did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    summary = status === "UNKNOWN" ? `${id} command could not be observed reliably` : `${id} command failed`;
  }
  return { id, status, summary, ...(observed !== undefined ? { observed } : {}), process };
}

export async function runProbes(config: CanaryConfig, installed: InstalledTarget): Promise<ProbeReceipt[]> {
  const receipts: ProbeReceipt[] = [];
  for (const id of config.contracts.checks) {
    if (id === "version") receipts.push(await versionProbe(config, installed));
    else if (id === "help") receipts.push(await helpProbe(config, installed));
    else if (id === "config") receipts.push(await jsonProbe("config", config, installed, ["config", "validate", "--json"], []));
    else if (id === "hooks") receipts.push(await jsonProbe("hooks", config, installed, ["hooks", "list", "--json"], config.contracts.requiredHooks));
    else if (id === "mcp") receipts.push(await jsonProbe("mcp", config, installed, ["mcp", "list", "--json"], config.contracts.requiredMcpServers));
  }
  return receipts;
}
