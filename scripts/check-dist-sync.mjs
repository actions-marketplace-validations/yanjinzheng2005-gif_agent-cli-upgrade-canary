import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["diff", "--exit-code", "--", "dist"], { encoding: "utf8" });
if (result.error) throw new Error(`Cannot compare committed bundles: ${result.error.message}`);
if (result.status !== 0) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  throw new Error("Committed dist/ bundles do not match src/. Run npm run build and commit the updated dist/ files.");
}
console.log("Source/bundle consistency check: PASS");
