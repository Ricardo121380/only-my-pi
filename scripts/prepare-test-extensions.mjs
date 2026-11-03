#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const contract = process.platform === "linux" ? "linux-external" : "external";
const prefix = path.join(root, "contracts/release", contract);
const npmCli = fs.realpathSync(path.join(path.dirname(process.execPath), "npm"));

// Reuse the committed platform lock, including its sandbox dependency. Never
// discover extensions or credentials in the developer's Pi installation.
// npm rejects loading the same config path twice. Use distinct empty files so
// neither developer nor runner credentials enter the fixture installation.
const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-npm-"));
try {
  const userConfig = path.join(configRoot, "user.npmrc");
  const globalConfig = path.join(configRoot, "global.npmrc");
  fs.writeFileSync(userConfig, "");
  fs.writeFileSync(globalConfig, "");
  execFileSync(process.execPath, [npmCli, "ci", "--prefix", prefix,
    "--ignore-scripts", "--omit=peer", "--legacy-peer-deps", "--no-audit", "--no-fund",
    `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`, "--registry=https://registry.npmjs.org/"], {
    cwd: root, stdio: "inherit", timeout: 180_000,
  });
} finally {
  fs.rmSync(configRoot, { recursive: true, force: true });
}
process.stdout.write(`TEST_EXTENSIONS_READY: ${contract} committed lock, lifecycle scripts disabled\n`);
