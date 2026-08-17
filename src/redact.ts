import type { ProcessResult } from "./types.js";

export function redactText(input: string, replacements: Array<[string, string]> = []): string {
  let output = input;
  for (const [needle, replacement] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    if (needle) output = output.split(needle).join(replacement);
  }
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  output = output.replace(/\b(?:sk|gh[opusr]|xox[baprs])_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]");
  output = output.replace(/("(?:apiKey|token|secret|password)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
  return output;
}

export function sanitizeProcess(result: ProcessResult, replacements: Array<[string, string]>): ProcessResult {
  return {
    ...result,
    argv: result.argv.map((value) => redactText(value, replacements)),
    cwd: redactText(result.cwd, replacements),
    stdout: redactText(result.stdout, replacements),
    stderr: redactText(result.stderr, replacements),
    ...(result.spawnError ? { spawnError: redactText(result.spawnError, replacements) } : {})
  };
}

export function sanitizeValue<T>(value: T, replacements: Array<[string, string]>): T {
  if (typeof value === "string") return redactText(value, replacements) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, replacements)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) output[key] = sanitizeValue(item, replacements);
    return output as T;
  }
  return value;
}
