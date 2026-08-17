import { readFile } from "node:fs/promises";

const files = ["src/installer.ts", "src/core.ts", "src/probes.ts", "README.md", "SECURITY.md"];
const text = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
for (const forbidden of ["ghp_exampleleak", "sk-exampleleak", "OPENAI_API_KEY:", "ANTHROPIC_API_KEY:"]) {
  if (text.includes(forbidden)) throw new Error(`Forbidden credential-like material found: ${forbidden}`);
}
const installer = await readFile("src/installer.ts", "utf8");
for (const required of ["OPENCLAW_HOME", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "OPENCLAW_WORKSPACE_DIR", "--ignore-scripts"]) {
  if (!installer.includes(required)) throw new Error(`Isolation boundary missing from installer: ${required}`);
}
if (/\.\.\.process\.env/.test(installer)) throw new Error("Installer must not inherit the entire parent environment");
console.log("Isolation and credential boundary check: PASS");
