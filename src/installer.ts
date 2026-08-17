import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanaryConfig, InstallReceipt, ProcessResult, Status, VersionTargetConfig } from "./types.js";
import { execute, processPassed } from "./process.js";

export interface InstalledTarget {
  receipt: InstallReceipt;
  packageRoot?: string;
  executable?: string;
  env: NodeJS.ProcessEnv;
  stateRoot: string;
  workRoot: string;
}

function looksTransientNetwork(result: ProcessResult): boolean {
  const text = `${result.stdout}\n${result.stderr}\n${result.spawnError ?? ""}`.toLowerCase();
  return /econnreset|econnrefused|etimedout|enotfound|network|socket hang up|429|502|503|504/.test(text);
}

function installStatus(result: ProcessResult): Status {
  if (processPassed(result)) return "PASS";
  if (result.timedOut || result.spawnError || looksTransientNetwork(result)) return "UNKNOWN";
  return "FAIL";
}

function safeParentEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "WINDIR", "ProgramFiles", "ProgramFiles(x86)", "LANG", "LC_ALL"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function packageEntry(packageRoot: string, packageName: string): Promise<{ version: string; executable: string }> {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown; bin?: unknown };
  if (typeof packageJson.version !== "string") throw new Error(`${packageName} package.json has no version`);
  let entry: unknown = packageJson.bin;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const bins = entry as Record<string, unknown>;
    entry = bins.openclaw ?? bins[packageName] ?? Object.values(bins)[0];
  }
  if (typeof entry !== "string") throw new Error(`${packageName} package.json has no executable bin`);
  const resolvedRoot = await realpath(packageRoot);
  const resolvedEntry = await realpath(path.resolve(packageRoot, entry));
  if (resolvedEntry !== resolvedRoot && !resolvedEntry.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Executable escapes installed package root: ${entry}`);
  }
  return { version: packageJson.version, executable: resolvedEntry };
}

export async function installTarget(
  config: CanaryConfig,
  label: "baseline" | "candidate",
  target: VersionTargetConfig,
  targetRoot: string
): Promise<InstalledTarget> {
  const installRoot = path.join(targetRoot, "install");
  const stateRoot = path.join(targetRoot, "state");
  const workRoot = path.join(targetRoot, "workspace");
  const cacheRoot = path.join(targetRoot, "npm-cache");
  const tempRoot = path.join(targetRoot, "tmp");
  await Promise.all([installRoot, stateRoot, workRoot, cacheRoot, tempRoot].map((directory) => mkdir(directory, { recursive: true })));
  const configPath = path.join(stateRoot, "openclaw.json");
  await writeFile(configPath, `${JSON.stringify(config.openclawConfig, null, 2)}\n`, { mode: 0o600 });
  const npmrcPath = path.join(targetRoot, "npmrc");
  await writeFile(npmrcPath, "audit=false\nfund=false\nupdate-notifier=false\n", { mode: 0o600 });

  const env: NodeJS.ProcessEnv = {
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
  const packageRoot = path.join(installRoot, "node_modules", packageName);
  let processResult: ProcessResult | undefined;
  let status: Status = "PASS";
  let summary: string;

  try {
    if (target.localPackagePath) {
      await mkdir(path.dirname(packageRoot), { recursive: true });
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
      return { receipt: { status, requestedVersion: target.version, summary, ...(processResult ? { process: processResult } : {}) }, env, stateRoot, workRoot };
    }
    const installed = await packageEntry(packageRoot, packageName);
    return {
      receipt: {
        status: "PASS",
        requestedVersion: target.version,
        installedVersion: installed.version,
        summary,
        ...(processResult ? { process: processResult } : {})
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
        ...(processResult ? { process: processResult } : {})
      },
      env,
      stateRoot,
      workRoot
    };
  }
}
