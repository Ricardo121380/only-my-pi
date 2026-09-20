#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
const output = process.argv[2];
if (!path.isAbsolute(output ?? "") || path.resolve(output).startsWith(process.cwd() + path.sep)) throw new Error("evidence directory must be outside the source repository");
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
const tests = (await fs.readdir("tests")).filter((name) => /^(host-|direct-agent-|omp-direct-|direct-writer-|m12-|release-stack-|release-payload-|stack-transaction|distribution-).*\.test\.mjs$/.test(name)).map((name) => `tests/${name}`);
const commands = [
  ["node-regression", process.execPath, ["--test", ...tests]],
  ...["test:web", "typecheck", "build:web", "lint", "schema:check", "pack:check", "agents:check", "secret:scan"].map((name) => [name.replaceAll(":", "-"), "npm", ["run", name]]),
  ["diff-check", "git", ["diff", "--check"]],
];
const receipt = { sourceCommit, sourceClean: !dirty.trim(), node: process.version, platform: `${process.platform}-${process.arch}`, status: "NOT_RUN", modelRequests: 0, checks: [] };
for (const [name, executable, args] of commands) {
  const start = performance.now(); let log = "";
  const code = await new Promise((resolve) => { const child = spawn(executable, args, { env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] }); child.stdout.on("data", (data) => { log += data; }); child.stderr.on("data", (data) => { log += data; }); child.on("error", (error) => { log += error.message; resolve(-1); }); child.on("close", resolve); });
  const record = { name, command: [executable, ...args], status: code === 0 ? "PASS" : "FAIL", exitCode: code, durationMs: Math.round(performance.now() - start), logDigest: createHash("sha256").update(log).digest("hex") };
  await fs.writeFile(path.join(output, `${name}.log`), log, { mode: 0o600 }); receipt.checks.push(record); console.log(`${record.status} ${name} (${record.durationMs}ms)`);
}
receipt.status = receipt.checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
await fs.writeFile(path.join(output, "deterministic.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
if (receipt.status !== "PASS") process.exitCode = 1;
