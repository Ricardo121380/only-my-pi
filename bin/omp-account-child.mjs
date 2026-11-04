#!/usr/bin/env node
import { loadDistribution } from "../packages/distribution/runtime.mjs";
import { runAccountChild } from "../packages/direct-agent/account-child.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function sourceChildStack() {
  if (process.env.ONLY_MY_PI_MINIMAL !== "1" || process.env.ONLY_MY_PI_READONLY_SUBAGENTS !== "1") return null;
  const root = process.env.OMP_HOST_ACCOUNT_STACK_ROOT;
  if (!path.isAbsolute(root ?? "")) throw new Error("CHILD_STACK_REQUIRED");
  const expectedNode = process.env.OMP_HOST_ACCOUNT_NODE_PATH;
  const requiredNode = (await fs.readFile(new URL("../.node-version", import.meta.url), "utf8")).trim();
  if (process.version !== `v${requiredNode}` || !path.isAbsolute(expectedNode ?? "") || await fs.realpath(process.execPath) !== await fs.realpath(expectedNode)) throw new Error("CHILD_NODE_MISMATCH");
  const sdk = await fs.realpath(path.join(root, "pi/dist/index.js"));
  if (sdk !== await fs.realpath(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))) throw new Error("CHILD_STACK_MISMATCH");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "pi/package.json"), "utf8"));
  const source = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (manifest.version !== source.devDependencies[manifest.name]) throw new Error("CHILD_STACK_MISMATCH");
  return { root };
}

try {
  const stack = await loadDistribution() ?? await sourceChildStack();
  if (!stack) throw new Error("CONTROLLED_STACK_REQUIRED");
  process.exitCode = await runAccountChild({ stack, configRoot: process.env.OMP_HOST_ACCOUNT_CONFIG_ROOT, accountId: process.env.OMP_HOST_ACCOUNT_ID, argv: process.argv.slice(2), readonly: process.env.ONLY_MY_PI_READONLY_SUBAGENTS === "1", modelId: process.env.OMP_HOST_ACCOUNT_MODEL, deepseekOnly: process.env.ONLY_MY_PI_DEEPSEEK_ONLY === "1" });
} catch {
  // Never print provider exceptions, CLI diagnostics, or credential paths.
  process.stderr.write("OMP_CHILD_ACCOUNT_EXECUTION_FAILED\n");
  process.exitCode = 1;
}
