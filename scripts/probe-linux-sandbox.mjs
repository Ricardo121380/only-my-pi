#!/usr/bin/env node
// Environment feasibility only: this is not OMP product/release acceptance.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(callback);
const receipt = { formatVersion: 1, status: "BLOCKED", productAcceptance: false,
  sourceCommit: process.env.GITHUB_SHA ?? null, platform: process.platform,
  arch: process.arch, node: process.versions.node, kernel: os.release(), checks: [] };
let root;
let server;
try {
  assert.equal(process.platform, "linux", "requires native Linux");
  assert.notEqual(process.getuid(), 0, "must run as a non-root user");
  assert.ok(process.report.getReport().header.glibcVersionRuntime, "requires glibc");
  receipt.dependencies = {};
  for (const [name, flag] of [["git", "--version"], ["bwrap", "--version"], ["socat", "-V"], ["rg", "--version"]]) {
    const result = await execFile(name, [flag], { timeout: 5000 });
    receipt.dependencies[name] = (result.stdout || result.stderr).trim().split("\n")[0];
  }
  root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-linux-probe-"));
  await fs.mkdir(path.join(root, "allowed"));
  await fs.writeFile(path.join(root, "secret"), "private probe sentinel");
  await fs.writeFile(path.join(root, "outside"), "unchanged");
  server = net.createServer((socket) => socket.end("reachable"));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  // Establish that the endpoint really is reachable before testing denial.
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.setTimeout(3000, () => socket.destroy(new Error("baseline network timeout")));
    socket.once("error", reject);
    socket.resume();
    socket.once("end", () => { socket.end(); resolve(); });
  });
  const namespaces = await Promise.all(["net", "pid"].map((name) => fs.readlink(`/proc/self/ns/${name}`)));
  const child = `
    const fs = require('node:fs'), net = require('node:net'), assert = require('node:assert/strict');
    const [root, parentNet, parentPid, port] = process.argv.slice(1);
    assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), parentNet);
    assert.notEqual(fs.readlinkSync('/proc/self/ns/pid'), parentPid);
    assert.equal(fs.readFileSync(root + '/secret', 'utf8'), '');
    assert.throws(() => fs.writeFileSync(root + '/outside', 'forbidden'), {code:'EROFS'});
    fs.writeFileSync('/tmp/omp-allowed/result', 'allowed');
    const socket = net.connect(Number(port), '127.0.0.1');
    socket.setTimeout(2000, () => { socket.destroy(); console.log('NETWORK_DENIED'); });
    socket.on('connect', () => { socket.destroy(); process.exitCode = 1; });
    socket.on('error', (error) => {
      assert.ok(['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(error.code));
      console.log('NETWORK_DENIED');
    });
  `;
  // Only the allowed directory is writable. Hide the private sentinel while
  // retaining a real, readable but read-only outside file for the write test.
  const result = await execFile("bwrap", ["--new-session", "--die-with-parent", "--unshare-user",
    "--unshare-pid", "--unshare-net", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
    "--tmpfs", "/tmp", "--ro-bind", root, root, "--ro-bind", "/dev/null", `${root}/secret`,
    "--bind", path.join(root, "allowed"), "/tmp/omp-allowed", "--chdir", "/tmp/omp-allowed",
    "--", process.execPath, "-e", child, root, ...namespaces, String(port)], { timeout: 15000 });
  assert.match(result.stdout, /NETWORK_DENIED/);
  assert.equal(await fs.readFile(path.join(root, "allowed/result"), "utf8"), "allowed");
  assert.equal(await fs.readFile(path.join(root, "outside"), "utf8"), "unchanged");
  receipt.checks = ["nonRoot", "dependencies", "glibc", "freshProc", "pidNamespace", "networkNamespace",
    "realNetworkDenied", "privateReadDenied", "outsideWriteDenied", "allowedWrite"];
  receipt.status = "LINUX_SANDBOX_PREFLIGHT_PASS";
} catch (error) {
  receipt.error = { message: error.message, stderr: error.stderr ?? null };
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt, null, 2));
}
