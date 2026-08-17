import { access, readFile } from "node:fs/promises";

for (const file of ["dist/cli.js", "dist/action.cjs", "dist/library.js"]) await access(file);
const cli = await readFile("dist/cli.js", "utf8");
if (!cli.startsWith("#!/usr/bin/env node")) throw new Error("dist/cli.js is missing its executable shebang");
const action = await readFile("dist/action.cjs", "utf8");
if (!action.includes("agent-upgrade-canary/receipt-v1")) throw new Error("Action bundle does not contain the receipt implementation");
console.log("Distribution bundle check: PASS");
