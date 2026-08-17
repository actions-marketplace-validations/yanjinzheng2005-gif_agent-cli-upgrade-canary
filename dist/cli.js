#!/usr/bin/env node

// src/cli.ts
import { copyFile, mkdir as mkdir3 } from "node:fs/promises";
import path5 from "node:path";
import { fileURLToPath } from "node:url";

// src/config.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
var PROBES = ["version", "help", "config", "hooks", "mcp"];
var SAFE_VERSION = /^(?:[0-9A-Za-z][0-9A-Za-z.+_-]*|latest|next|beta|alpha|extended-stable)$/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}
function positiveInteger(value, fallback, field) {
  if (value === void 0) return fallback;
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`);
  return Number(value);
}
function stringList(value, fallback, field) {
  if (value === void 0) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value.map((item) => String(item));
}
function targetValue(value, field, configDirectory, adapter) {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  const version = stringValue(value.version, `${field}.version`);
  if (!SAFE_VERSION.test(version)) throw new Error(`${field}.version must be an exact npm version or a known dist-tag`);
  const local = value.localPackagePath;
  if (local !== void 0 && adapter !== "fixture") throw new Error(`${field}.localPackagePath is allowed only for the fixture adapter`);
  if (local !== void 0 && typeof local !== "string") throw new Error(`${field}.localPackagePath must be a string`);
  return local === void 0 ? { version } : { version, localPackagePath: path.resolve(configDirectory, local) };
}
async function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const configDirectory = path.dirname(absolutePath);
  let parsed;
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
    if (!PROBES.includes(item)) throw new Error(`Unsupported check: ${item}`);
    return item;
  });
  if (new Set(checks).size !== checks.length) throw new Error("contracts.checks must not contain duplicates");
  const openclawConfig = parsed.openclawConfig === void 0 ? { gateway: { mode: "local" } } : parsed.openclawConfig;
  if (!isRecord(openclawConfig)) throw new Error("openclawConfig must be an object");
  return {
    schemaVersion: "agent-upgrade-canary/v1",
    name: parsed.name === void 0 ? "Agent CLI upgrade canary" : stringValue(parsed.name, "name"),
    adapter,
    targets: {
      baseline: targetValue(parsed.targets.baseline, "targets.baseline", configDirectory, adapter),
      candidate: targetValue(parsed.targets.candidate, "targets.candidate", configDirectory, adapter)
    },
    runtime: {
      nodeExecutable: runtime.nodeExecutable === void 0 ? process.execPath : stringValue(runtime.nodeExecutable, "runtime.nodeExecutable"),
      npmExecutable: runtime.npmExecutable === void 0 ? process.platform === "win32" ? "npm.cmd" : "npm" : stringValue(runtime.npmExecutable, "runtime.npmExecutable"),
      installTimeoutMs: positiveInteger(runtime.installTimeoutMs, 3e5, "runtime.installTimeoutMs"),
      probeTimeoutMs: positiveInteger(runtime.probeTimeoutMs, 3e4, "runtime.probeTimeoutMs"),
      maxOutputBytes: positiveInteger(runtime.maxOutputBytes, 1e6, "runtime.maxOutputBytes")
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
function validateConfigObject(config) {
  if (config.adapter === "openclaw") {
    for (const target of [config.targets.baseline, config.targets.candidate]) {
      if (target.localPackagePath) throw new Error("OpenClaw targets cannot use localPackagePath");
    }
  }
}

// src/core.ts
import { mkdtemp, realpath as realpath2, rm } from "node:fs/promises";
import os from "node:os";
import path3 from "node:path";

// src/installer.ts
import { cp, mkdir, readFile as readFile2, realpath, writeFile } from "node:fs/promises";
import path2 from "node:path";

// src/process.ts
import { spawn } from "node:child_process";
function windowsCommand(argv) {
  const [file = "", ...args] = argv;
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(file)) return { file, args };
  return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/c", file, ...args] };
}
function terminateWindowsProcessTree(pid) {
  try {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => {
    });
    killer.unref();
  } catch {
  }
}
async function execute(spec) {
  const started = Date.now();
  const command = windowsCommand(spec.argv);
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;
  let timedOut = false;
  return await new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn(command.file, command.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      resolve({
        argv: spec.argv,
        cwd: spec.cwd,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
        spawnError: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    const append = (target, chunk) => {
      const used = target === "stdout" ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, spec.maxOutputBytes - used);
      if (remaining === 0) {
        truncated = true;
        return;
      }
      const kept = chunk.subarray(0, remaining);
      if (target === "stdout") {
        stdout += kept.toString("utf8");
        stdoutBytes += kept.length;
      } else {
        stderr += kept.toString("utf8");
        stderrBytes += kept.length;
      }
      if (kept.length < chunk.length) truncated = true;
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      try {
        if (process.platform === "win32") terminateWindowsProcessTree(child.pid);
        else process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        if (settled || !child.pid) return;
        try {
          if (process.platform === "win32") {
            terminateWindowsProcessTree(child.pid);
            child.kill("SIGKILL");
          } else process.kill(-child.pid, "SIGKILL");
        } catch {
        }
      }, 500).unref();
    }, spec.timeoutMs);
    timer.unref();
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        argv: spec.argv,
        cwd: spec.cwd,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
        spawnError: error.message
      });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ argv: spec.argv, cwd: spec.cwd, exitCode, signal, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started });
    });
  });
}
function processPassed(result) {
  return !result.timedOut && !result.spawnError && result.exitCode === 0;
}

// src/installer.ts
function looksTransientNetwork(result) {
  const text = `${result.stdout}
${result.stderr}
${result.spawnError ?? ""}`.toLowerCase();
  return /econnreset|econnrefused|etimedout|enotfound|network|socket hang up|429|502|503|504/.test(text);
}
function installStatus(result) {
  if (processPassed(result)) return "PASS";
  if (result.timedOut || result.spawnError || looksTransientNetwork(result)) return "UNKNOWN";
  return "FAIL";
}
function safeParentEnvironment() {
  const allowed = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "WINDIR", "ProgramFiles", "ProgramFiles(x86)", "LANG", "LC_ALL"];
  const env = {};
  for (const key of allowed) if (process.env[key] !== void 0) env[key] = process.env[key];
  return env;
}
async function packageEntry(packageRoot, packageName) {
  const packageJsonPath = path2.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile2(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string") throw new Error(`${packageName} package.json has no version`);
  let entry = packageJson.bin;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const bins = entry;
    entry = bins.openclaw ?? bins[packageName] ?? Object.values(bins)[0];
  }
  if (typeof entry !== "string") throw new Error(`${packageName} package.json has no executable bin`);
  const resolvedRoot = await realpath(packageRoot);
  const resolvedEntry = await realpath(path2.resolve(packageRoot, entry));
  if (resolvedEntry !== resolvedRoot && !resolvedEntry.startsWith(`${resolvedRoot}${path2.sep}`)) {
    throw new Error(`Executable escapes installed package root: ${entry}`);
  }
  return { version: packageJson.version, executable: resolvedEntry };
}
async function installTarget(config, label, target, targetRoot) {
  const installRoot = path2.join(targetRoot, "install");
  const stateRoot = path2.join(targetRoot, "state");
  const workRoot = path2.join(targetRoot, "workspace");
  const cacheRoot = path2.join(targetRoot, "npm-cache");
  const tempRoot = path2.join(targetRoot, "tmp");
  await Promise.all([installRoot, stateRoot, workRoot, cacheRoot, tempRoot].map((directory) => mkdir(directory, { recursive: true })));
  const configPath = path2.join(stateRoot, "openclaw.json");
  await writeFile(configPath, `${JSON.stringify(config.openclawConfig, null, 2)}
`, { mode: 384 });
  const npmrcPath = path2.join(targetRoot, "npmrc");
  await writeFile(npmrcPath, "audit=false\nfund=false\nupdate-notifier=false\n", { mode: 384 });
  const env = {
    ...safeParentEnvironment(),
    CI: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    NPM_CONFIG_USERCONFIG: npmrcPath,
    NPM_CONFIG_CACHE: cacheRoot,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    OPENCLAW_HOME: targetRoot,
    OPENCLAW_STATE_DIR: stateRoot,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_WORKSPACE_DIR: workRoot,
    OPENCLAW_LOAD_SHELL_ENV: "0"
  };
  const packageName = config.adapter === "openclaw" ? "openclaw" : "fixture-agent-cli";
  const packageRoot = path2.join(installRoot, "node_modules", packageName);
  let processResult;
  let status = "PASS";
  let summary;
  try {
    if (target.localPackagePath) {
      await mkdir(path2.dirname(packageRoot), { recursive: true });
      await cp(target.localPackagePath, packageRoot, { recursive: true, force: true });
      summary = `Copied controlled local fixture ${target.version}`;
    } else {
      processResult = await execute({
        argv: [
          config.runtime.npmExecutable,
          "install",
          "--prefix",
          installRoot,
          "--no-save",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--loglevel=error",
          `${packageName}@${target.version}`
        ],
        cwd: targetRoot,
        env,
        timeoutMs: config.runtime.installTimeoutMs,
        maxOutputBytes: config.runtime.maxOutputBytes
      });
      status = installStatus(processResult);
      summary = status === "PASS" ? `Installed ${packageName}@${target.version} in the isolated prefix` : `Isolated install did not complete: ${status}`;
    }
    if (status !== "PASS") {
      return { receipt: { status, requestedVersion: target.version, summary, ...processResult ? { process: processResult } : {} }, env, stateRoot, workRoot };
    }
    const installed = await packageEntry(packageRoot, packageName);
    return {
      receipt: {
        status: "PASS",
        requestedVersion: target.version,
        installedVersion: installed.version,
        summary,
        ...processResult ? { process: processResult } : {}
      },
      packageRoot,
      executable: installed.executable,
      env,
      stateRoot,
      workRoot
    };
  } catch (error) {
    return {
      receipt: {
        status: "FAIL",
        requestedVersion: target.version,
        summary: `Install verification failed: ${error instanceof Error ? error.message : String(error)}`,
        ...processResult ? { process: processResult } : {}
      },
      env,
      stateRoot,
      workRoot
    };
  }
}

// src/probes.ts
function statusForProcess(result) {
  if (result.timedOut || result.spawnError) return "UNKNOWN";
  return processPassed(result) ? "PASS" : "FAIL";
}
function combinedOutput(result) {
  return `${result.stdout}
${result.stderr}`.trim();
}
function parseJsonOutput(result) {
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
function hookRecords(value) {
  if (!value || typeof value !== "object") return [];
  const record = value;
  const hooks = Array.isArray(value) ? value : record.hooks;
  if (!Array.isArray(hooks)) return [];
  return hooks.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}
function hookNames(value) {
  const names = /* @__PURE__ */ new Set();
  for (const record of hookRecords(value)) {
    const name = [record.key, record.name, record.id].find((candidate) => typeof candidate === "string");
    if (typeof name === "string") names.add(name);
  }
  return names;
}
function mcpNames(value) {
  const names = /* @__PURE__ */ new Set();
  if (!value || typeof value !== "object") return names;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record2 = item;
      const name = [record2.name, record2.id, record2.serverName].find((candidate) => typeof candidate === "string");
      if (typeof name === "string") names.add(name);
    }
    return names;
  }
  const record = value;
  const servers = record.servers;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    for (const key of Object.keys(servers)) names.add(key);
  } else {
    for (const key of Object.keys(record)) names.add(key);
  }
  return names;
}
function unreadyHooks(value, requiredNames) {
  const readiness = new Map(requiredNames.map((name) => [name, false]));
  for (const record of hookRecords(value)) {
    const name = [record.key, record.name, record.id].find((candidate) => typeof candidate === "string");
    if (name && readiness.has(name)) {
      const ready = record.eligible !== false && record.requirementsSatisfied !== false && record.loadable !== false && record.disabled !== true;
      if (ready) readiness.set(name, true);
    }
  }
  return [...readiness.entries()].filter(([, ready]) => !ready).map(([name]) => name);
}
function exactVersionObserved(output, expected) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9A-Za-z.+_-])v?${escaped}(?![0-9A-Za-z.+_-])`).test(output);
}
async function runCommand(config, installed, args) {
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
async function versionProbe(config, installed) {
  const process2 = await runCommand(config, installed, ["--version"]);
  let status = statusForProcess(process2);
  const expected = installed.receipt.installedVersion;
  if (status === "PASS" && expected && !exactVersionObserved(combinedOutput(process2), expected)) status = "FAIL";
  return {
    id: "version",
    status,
    summary: status === "PASS" ? `CLI reports installed version ${expected}` : `CLI version output did not prove installed version ${expected ?? "unknown"}`,
    observed: { expectedVersion: expected, output: combinedOutput(process2) },
    process: process2
  };
}
async function helpProbe(config, installed) {
  const process2 = await runCommand(config, installed, ["--help"]);
  let status = statusForProcess(process2);
  if (status === "PASS" && combinedOutput(process2).length < 20) status = "FAIL";
  return { id: "help", status, summary: status === "PASS" ? "CLI help starts without credentials" : "CLI help did not produce a usable response", process: process2 };
}
async function jsonProbe(id, config, installed, args, requiredNames) {
  let process2 = await runCommand(config, installed, args);
  if (id === "mcp" && !processPassed(process2) && /unknown (?:option|command)|unrecognized/i.test(combinedOutput(process2))) {
    process2 = await runCommand(config, installed, ["mcp", "status", "--json"]);
  }
  let status = statusForProcess(process2);
  let observed;
  let summary;
  if (status === "PASS") {
    try {
      observed = parseJsonOutput(process2);
      const names = id === "hooks" ? hookNames(observed) : id === "mcp" ? mcpNames(observed) : /* @__PURE__ */ new Set();
      const missing = requiredNames.filter((name) => !names.has(name));
      const unready = id === "hooks" ? unreadyHooks(observed, requiredNames.filter((name) => names.has(name))) : [];
      if (id === "config" && observed && typeof observed === "object") {
        const record = observed;
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
  return { id, status, summary, ...observed !== void 0 ? { observed } : {}, process: process2 };
}
async function runProbes(config, installed) {
  const receipts = [];
  for (const id of config.contracts.checks) {
    if (id === "version") receipts.push(await versionProbe(config, installed));
    else if (id === "help") receipts.push(await helpProbe(config, installed));
    else if (id === "config") receipts.push(await jsonProbe("config", config, installed, ["config", "validate", "--json"], []));
    else if (id === "hooks") receipts.push(await jsonProbe("hooks", config, installed, ["hooks", "list", "--json"], config.contracts.requiredHooks));
    else if (id === "mcp") receipts.push(await jsonProbe("mcp", config, installed, ["mcp", "list", "--json"], config.contracts.requiredMcpServers));
  }
  return receipts;
}

// src/redact.ts
function redactText(input, replacements = []) {
  let output = input;
  for (const [needle, replacement] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    if (needle) output = output.split(needle).join(replacement);
  }
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  output = output.replace(/\b(?:sk|gh[opusr]|xox[baprs])_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]");
  output = output.replace(/("(?:apiKey|token|secret|password)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
  return output;
}
function sanitizeProcess(result, replacements) {
  return {
    ...result,
    argv: result.argv.map((value) => redactText(value, replacements)),
    cwd: redactText(result.cwd, replacements),
    stdout: redactText(result.stdout, replacements),
    stderr: redactText(result.stderr, replacements),
    ...result.spawnError ? { spawnError: redactText(result.spawnError, replacements) } : {}
  };
}
function sanitizeValue(value, replacements) {
  if (typeof value === "string") return redactText(value, replacements);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, replacements));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = sanitizeValue(item, replacements);
    return output;
  }
  return value;
}

// src/core.ts
var TOOL_VERSION = "0.1.1";
function combineStatus(statuses) {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("UNKNOWN")) return "UNKNOWN";
  return "PASS";
}
function classifyDelta(baseline, candidate) {
  if (baseline === "PASS" && candidate === "PASS") return "UNCHANGED_PASS";
  if (baseline === "PASS" && candidate === "FAIL") return "REGRESSION";
  if (baseline === "FAIL" && candidate === "PASS") return "RECOVERY";
  if (baseline === "FAIL" && candidate === "FAIL") return "UNCHANGED_FAIL";
  return "INCONCLUSIVE";
}
function createDeltas(baseline, candidate, checks) {
  const baselineMap = new Map(baseline.probes.map((probe) => [probe.id, probe.status]));
  const candidateMap = new Map(candidate.probes.map((probe) => [probe.id, probe.status]));
  const deltas = [
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
function verdictFor(candidate, deltas) {
  if (deltas.some((delta) => delta.classification === "REGRESSION")) return "REGRESSION";
  if (candidate.overall === "FAIL") return "CANDIDATE_FAILURE";
  if (candidate.overall === "UNKNOWN" || deltas.some((delta) => delta.classification === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "NO_REGRESSION";
}
function summaryFor(verdict, deltas) {
  const regressions = deltas.filter((delta) => delta.classification === "REGRESSION").map((delta) => delta.id);
  if (verdict === "REGRESSION") return `Candidate regressed: ${regressions.join(", ")}`;
  if (verdict === "CANDIDATE_FAILURE") return "Candidate failed one or more declared upgrade contracts";
  if (verdict === "INCONCLUSIVE") return "No regression claim can be made because at least one result is UNKNOWN";
  return "Candidate preserved every declared contract that the baseline passed";
}
async function runtimeVersion(config, cwd, env) {
  const result = await execute({
    argv: [config.runtime.nodeExecutable, "--version"],
    cwd,
    env,
    timeoutMs: 1e4,
    maxOutputBytes: 1e4
  });
  return result.exitCode === 0 ? result.stdout.trim() || result.stderr.trim() : void 0;
}
async function runTarget(config, label, runRoot, replacements) {
  const target = config.targets[label];
  const installed = await installTarget(config, label, target, path3.join(runRoot, label));
  const runtime = await runtimeVersion(config, installed.workRoot, installed.env);
  const probes = installed.receipt.status === "PASS" ? await runProbes(config, installed) : [];
  const overall = combineStatus([installed.receipt.status, ...probes.map((probe) => probe.status)]);
  const receipt = {
    label,
    requestedVersion: target.version,
    ...installed.receipt.installedVersion ? { installedVersion: installed.receipt.installedVersion } : {},
    ...runtime ? { runtimeVersion: runtime } : {},
    install: installed.receipt,
    probes,
    overall
  };
  if (receipt.install.process) receipt.install.process = sanitizeProcess(receipt.install.process, replacements);
  for (const probe of receipt.probes) probe.process = sanitizeProcess(probe.process, replacements);
  return sanitizeValue(receipt, replacements);
}
async function runCanary(config, options = { keepWorkdir: false }) {
  const runRoot = await mkdtemp(path3.join(os.tmpdir(), "agent-upgrade-canary-"));
  const canonicalRunRoot = await realpath2(runRoot);
  const replacements = [
    [runRoot, "$RUN_ROOT"],
    [canonicalRunRoot, "$RUN_ROOT"],
    [path3.join(runRoot, "baseline", "state"), "$BASELINE_STATE"],
    [path3.join(runRoot, "candidate", "state"), "$CANDIDATE_STATE"],
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
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
function exitCodeFor(receipt, failOn) {
  if (failOn === "never") return 0;
  if (failOn === "regression") return receipt.verdict === "REGRESSION" ? 1 : receipt.verdict === "INCONCLUSIVE" ? 2 : 0;
  return receipt.verdict === "NO_REGRESSION" ? 0 : receipt.verdict === "INCONCLUSIVE" ? 2 : 1;
}

// src/report.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import path4 from "node:path";
function statusMark(status) {
  if (status === "PASS") return "\u2705 PASS";
  if (status === "FAIL") return "\u274C FAIL";
  return "\u26AA UNKNOWN";
}
function probeRow(id, baseline, candidate) {
  return `| ${id} | ${statusMark(baseline?.status ?? "UNKNOWN")} | ${statusMark(candidate?.status ?? "UNKNOWN")} |`;
}
function renderMarkdown(receipt) {
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
    lines.push(probeRow(delta.id, baselineProbes.get(delta.id), candidateProbes.get(delta.id)));
  }
  lines.push("", "## Deltas", "");
  for (const delta of receipt.deltas) lines.push(`- ${delta.id}: ${delta.baseline} \u2192 ${delta.candidate} (${delta.classification})`);
  lines.push("", "## Candidate evidence", "");
  lines.push(`- **install** \u2014 ${receipt.candidate.install.status}: ${receipt.candidate.install.summary}`);
  for (const probe of receipt.candidate.probes) lines.push(`- **${probe.id}** \u2014 ${probe.status}: ${probe.summary}`);
  lines.push("", "## Evidence boundaries", "");
  for (const boundary of receipt.boundaries) lines.push(`- ${boundary}`);
  lines.push("");
  return lines.join("\n");
}
async function writeReports(receipt, outputDirectory) {
  const absoluteOutput = path4.resolve(outputDirectory);
  await mkdir2(absoluteOutput, { recursive: true });
  const jsonPath = path4.join(absoluteOutput, "agent-upgrade-canary-report.json");
  const markdownPath = path4.join(absoluteOutput, "agent-upgrade-canary-report.md");
  await Promise.all([
    writeFile2(jsonPath, `${JSON.stringify(receipt, null, 2)}
`),
    writeFile2(markdownPath, renderMarkdown(receipt))
  ]);
  return { jsonPath, markdownPath };
}

// src/cli.ts
function usage() {
  return `Agent CLI Upgrade Canary ${TOOL_VERSION}

Usage:
  agent-upgrade-canary validate --config <file>
  agent-upgrade-canary run --config <file> --output <dir> [--fail-on regression|fail|never] [--keep-workdir]
  agent-upgrade-canary init-openclaw --output <file>
  agent-upgrade-canary --version

The tool never upgrades the user's real CLI. Baseline and candidate run in separate isolated directories.`;
}
function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return void 0;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
function parseRun(args) {
  const config = option(args, "--config");
  const output = option(args, "--output");
  if (!config) throw new Error("--config is required");
  if (!output) throw new Error("--output is required");
  const failOn = option(args, "--fail-on") ?? "regression";
  if (failOn !== "regression" && failOn !== "fail" && failOn !== "never") throw new Error("--fail-on must be regression, fail, or never");
  return { config, output, failOn, keepWorkdir: args.includes("--keep-workdir") };
}
async function main() {
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
    const config2 = await loadConfig(configPath);
    validateConfigObject(config2);
    console.log(`Config PASS: ${path5.resolve(configPath)}`);
    return;
  }
  if (args[0] === "init-openclaw") {
    const output = option(args, "--output");
    if (!output) throw new Error("--output is required");
    const source = fileURLToPath(new URL("../examples/openclaw.example.json", import.meta.url));
    await mkdir3(path5.dirname(path5.resolve(output)), { recursive: true });
    await copyFile(source, path5.resolve(output));
    console.log(`Created ${path5.resolve(output)}`);
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
//# sourceMappingURL=cli.js.map
