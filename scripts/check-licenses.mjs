import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const allowed = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0", "0BSD"]);
const problems = [];
for (const [name, info] of Object.entries(lock.packages ?? {})) {
  if (!name || !info || !info.license) continue;
  const licenses = String(info.license).split(/\s+(?:OR|AND)\s+/).map((value) => value.replace(/[()]/g, ""));
  if (!licenses.some((license) => allowed.has(license))) problems.push(`${name}: ${info.license}`);
}
if (problems.length) throw new Error(`Unreviewed dependency licenses:\n${problems.join("\n")}`);
console.log("Dependency license check: PASS");
