export type Status = "PASS" | "FAIL" | "UNKNOWN";
export type Verdict = "NO_REGRESSION" | "REGRESSION" | "CANDIDATE_FAILURE" | "INCONCLUSIVE";
export type ProbeId = "version" | "help" | "config" | "hooks" | "mcp";

export interface VersionTargetConfig {
  version: string;
  localPackagePath?: string;
}

export interface CanaryConfig {
  schemaVersion: "agent-upgrade-canary/v1";
  name: string;
  adapter: "openclaw" | "fixture";
  targets: {
    baseline: VersionTargetConfig;
    candidate: VersionTargetConfig;
  };
  runtime: {
    nodeExecutable: string;
    npmExecutable: string;
    installTimeoutMs: number;
    probeTimeoutMs: number;
    maxOutputBytes: number;
  };
  contracts: {
    checks: ProbeId[];
    requiredHooks: string[];
    requiredMcpServers: string[];
  };
  openclawConfig: Record<string, unknown>;
  configDirectory: string;
}

export interface ProcessResult {
  argv: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  spawnError?: string;
}

export interface CommandSpec {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface InstallReceipt {
  status: Status;
  requestedVersion: string;
  installedVersion?: string;
  summary: string;
  process?: ProcessResult;
}

export interface ProbeReceipt {
  id: ProbeId;
  status: Status;
  summary: string;
  observed?: unknown;
  process: ProcessResult;
}

export interface TargetReceipt {
  label: "baseline" | "candidate";
  requestedVersion: string;
  installedVersion?: string;
  runtimeVersion?: string;
  install: InstallReceipt;
  probes: ProbeReceipt[];
  overall: Status;
}

export interface DeltaReceipt {
  id: "install" | ProbeId;
  baseline: Status;
  candidate: Status;
  classification: "UNCHANGED_PASS" | "UNCHANGED_FAIL" | "REGRESSION" | "RECOVERY" | "INCONCLUSIVE";
}

export interface CanaryReceipt {
  schemaVersion: "agent-upgrade-canary/receipt-v1";
  toolVersion: string;
  generatedAt: string;
  projectName: string;
  adapter: "openclaw" | "fixture";
  verdict: Verdict;
  summary: string;
  baseline: TargetReceipt;
  candidate: TargetReceipt;
  deltas: DeltaReceipt[];
  boundaries: string[];
}

export interface RunOptions {
  keepWorkdir: boolean;
}
