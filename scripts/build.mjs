import { build } from "esbuild";
import { chmod, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/cli.ts"],
    outfile: "dist/cli.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    legalComments: "eof"
  }),
  build({
    entryPoints: ["src/action.ts"],
    outfile: "dist/action.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    sourcemap: true,
    legalComments: "eof"
  }),
  build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/library.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: true,
    legalComments: "eof"
  })
]);

await chmod("dist/cli.js", 0o755);
