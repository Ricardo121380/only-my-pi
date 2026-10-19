#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ptyRoot = path.dirname(require.resolve("node-pty/package.json"));
assert.equal(require("node-pty/package.json").version, "1.1.0");

// Keep npm lifecycle scripts disabled. Linux has no shipped PTY prebuild;
// compile only this pinned binding with the selected Node's own headers.
if (process.platform === "linux") {
  const nodeRoot = path.resolve(path.dirname(process.execPath), "..");
  fs.accessSync(path.join(nodeRoot, "include/node/node.h"));
  const npmCli = fs.realpathSync(path.join(nodeRoot, "bin/npm"));
  const nodeGyp = createRequire(npmCli).resolve("node-gyp/bin/node-gyp.js");
  execFileSync(process.execPath, [nodeGyp, "rebuild", `--directory=${ptyRoot}`, `--nodedir=${nodeRoot}`], {
    cwd: root, stdio: "inherit", timeout: 120_000,
  });
} else if (process.platform === "darwin") {
  // npm preserves the upstream helper's non-executable archive mode.
  fs.chmodSync(path.join(ptyRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper"), 0o755);
} else {
  throw new Error("PTY test preparation supports the Linux and macOS CI lanes");
}

// Loading the addon alone misses an unusable spawn-helper. Exercise a real
// local PTY before the Host/CLI tests, without launching Pi or a Provider.
const pty = require("node-pty");
await new Promise((resolve, reject) => {
  let output = "";
  const terminal = pty.spawn("/bin/sh", ["-c", "printf OMP_PTY_READY"], {
    cwd: root, env: { PATH: "/usr/bin:/bin", TERM: "xterm" }, cols: 80, rows: 24,
  });
  const timer = setTimeout(() => {
    terminal.kill("SIGKILL");
    reject(new Error("PTY readiness timed out"));
  }, 10_000);
  terminal.onData(chunk => { output += chunk; });
  terminal.onExit(({ exitCode }) => {
    clearTimeout(timer);
    if (exitCode === 0 && output === "OMP_PTY_READY") resolve();
    else reject(new Error("PTY readiness failed"));
  });
});
process.stdout.write("PTY_READY: pinned native binding and process spawn verified\n");
