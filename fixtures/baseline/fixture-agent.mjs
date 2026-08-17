#!/usr/bin/env node
const args = process.argv.slice(2);
const inheritedSecrets = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"].filter((name) => process.env[name]);
if (inheritedSecrets.length) {
  console.error(`FORBIDDEN_PARENT_SECRET_PRESENT:${inheritedSecrets.join(",")}`);
  process.exit(91);
}
const isolated = Boolean(process.env.OPENCLAW_HOME && process.env.OPENCLAW_STATE_DIR && process.env.OPENCLAW_CONFIG_PATH && process.env.OPENCLAW_WORKSPACE_DIR);
if (args[0] === "--version") console.log("Fixture Agent 1.0.0");
else if (args[0] === "--help") console.log("Fixture Agent CLI\nCommands: config, hooks, mcp\nRuns only inside the canary fixture.");
else if (args[0] === "config" && args[1] === "validate") console.log(JSON.stringify({ valid: isolated }));
else if (args[0] === "hooks" && args[1] === "list") console.log(JSON.stringify({ hooks: [{ key: "boot-md" }, { key: "command-logger" }, { key: "session-memory" }] }));
else if (args[0] === "mcp" && args[1] === "list") console.log(JSON.stringify({ docs: { url: "http://127.0.0.1:9/mcp" } }));
else { console.error("Unknown fixture command"); process.exitCode = 2; }
