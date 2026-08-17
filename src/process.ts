import { spawn } from "node:child_process";
import type { CommandSpec, ProcessResult } from "./types.js";

function windowsCommand(argv: string[]): { file: string; args: string[] } {
  const [file = "", ...args] = argv;
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(file)) return { file, args };
  return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/c", file, ...args] };
}

function terminateWindowsProcessTree(pid: number): void {
  try {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => {});
    killer.unref();
  } catch {
    // The direct child kill below remains as a fallback.
  }
}

export async function execute(spec: CommandSpec): Promise<ProcessResult> {
  const started = Date.now();
  const command = windowsCommand(spec.argv);
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;
  let timedOut = false;

  return await new Promise<ProcessResult>((resolve) => {
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

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
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
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

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
          // The process may already be gone.
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

export function processPassed(result: ProcessResult): boolean {
  return !result.timedOut && !result.spawnError && result.exitCode === 0;
}
