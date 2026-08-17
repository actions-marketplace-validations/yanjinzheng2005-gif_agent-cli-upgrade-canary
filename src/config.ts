import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CanaryConfig, ProbeId, VersionTargetConfig } from "./types.js";

const PROBES: ProbeId[] = ["version", "help", "config", "hooks", "mcp"];
const SAFE_VERSION = /^(?:[0-9A-Za-z][0-9A-Za-z.+_-]*|latest|next|beta|alpha|extended-stable)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}

function positiveInteger(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`);
  return Number(value);
}

function stringList(value: unknown, fallback: string[], field: string): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value.map((item) => String(item));
}

function targetValue(value: unknown, field: string, configDirectory: string, adapter: CanaryConfig["adapter"]): VersionTargetConfig {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  const version = stringValue(value.version, `${field}.version`);
  if (!SAFE_VERSION.test(version)) throw new Error(`${field}.version must be an exact npm version or a known dist-tag`);
  const local = value.localPackagePath;
  if (local !== undefined && adapter !== "fixture") throw new Error(`${field}.localPackagePath is allowed only for the fixture adapter`);
  if (local !== undefined && typeof local !== "string") throw new Error(`${field}.localPackagePath must be a string`);
  return local === undefined ? { version } : { version, localPackagePath: path.resolve(configDirectory, local) };
}

export async function loadConfig(configPath: string): Promise<CanaryConfig> {
  const absolutePath = path.resolve(configPath);
  const configDirectory = path.dirname(absolutePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read config ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error("config must be a JSON object");
  if (parsed.schemaVersion !== "agent-upgrade-canary/v1") {
    throw new Error('schemaVersion must be "agent-upgrade-canary/v1"');
  }
  const adapter = parsed.adapter;
  if (adapter !== "openclaw" && adapter !== "fixture") throw new Error("adapter must be openclaw or fixture");
  if (!isRecord(parsed.targets)) throw new Error("targets must be an object");
  const runtime = isRecord(parsed.runtime) ? parsed.runtime : {};
  const contracts = isRecord(parsed.contracts) ? parsed.contracts : {};
  const rawChecks = stringList(contracts.checks, PROBES, "contracts.checks");
  const checks = rawChecks.map((item) => {
    if (!PROBES.includes(item as ProbeId)) throw new Error(`Unsupported check: ${item}`);
    return item as ProbeId;
  });
  if (new Set(checks).size !== checks.length) throw new Error("contracts.checks must not contain duplicates");
  const openclawConfig = parsed.openclawConfig === undefined ? { gateway: { mode: "local" } } : parsed.openclawConfig;
  if (!isRecord(openclawConfig)) throw new Error("openclawConfig must be an object");

  return {
    schemaVersion: "agent-upgrade-canary/v1",
    name: parsed.name === undefined ? "Agent CLI upgrade canary" : stringValue(parsed.name, "name"),
    adapter,
    targets: {
      baseline: targetValue(parsed.targets.baseline, "targets.baseline", configDirectory, adapter),
      candidate: targetValue(parsed.targets.candidate, "targets.candidate", configDirectory, adapter)
    },
    runtime: {
      nodeExecutable: runtime.nodeExecutable === undefined ? process.execPath : stringValue(runtime.nodeExecutable, "runtime.nodeExecutable"),
      npmExecutable: runtime.npmExecutable === undefined ? (process.platform === "win32" ? "npm.cmd" : "npm") : stringValue(runtime.npmExecutable, "runtime.npmExecutable"),
      installTimeoutMs: positiveInteger(runtime.installTimeoutMs, 300_000, "runtime.installTimeoutMs"),
      probeTimeoutMs: positiveInteger(runtime.probeTimeoutMs, 30_000, "runtime.probeTimeoutMs"),
      maxOutputBytes: positiveInteger(runtime.maxOutputBytes, 1_000_000, "runtime.maxOutputBytes")
    },
    contracts: {
      checks,
      requiredHooks: stringList(contracts.requiredHooks, [], "contracts.requiredHooks"),
      requiredMcpServers: stringList(contracts.requiredMcpServers, [], "contracts.requiredMcpServers")
    },
    openclawConfig,
    configDirectory
  };
}

export function validateConfigObject(config: CanaryConfig): void {
  if (config.adapter === "openclaw") {
    for (const target of [config.targets.baseline, config.targets.candidate]) {
      if (target.localPackagePath) throw new Error("OpenClaw targets cannot use localPackagePath");
    }
  }
}
