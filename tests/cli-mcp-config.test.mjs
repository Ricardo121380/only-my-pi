import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const cli = fileURLToPath(new URL("../bin/omp.mjs", import.meta.url));
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-mcp-")));
  const config = path.join(root, "config"), project = path.join(root, "project");
  await fs.mkdir(project); await fs.mkdir(config);
  t.after(() => fs.rm(root, { recursive: true }));
  const run = (args, input = "") => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "mcp", ...args], { cwd: project,
      env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: config }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on("error", error => { if (error.code !== "EPIPE") reject(error); }); child.stdin.end(input);
  });
  return { root, config, project, run, async apply(input, scope = project) {
    const file = path.join(root, "action.json"); await fs.writeFile(file, JSON.stringify(input));
    const result = await run(["apply", file, ...(scope ? ["--project", scope] : [])]);
    assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout);
  } };
}
const server = { name: "remote", transport: "streamable-http", url: "http://127.0.0.1:1/mcp", credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }], enabled: false };

test("standalone public MCP CLI accepts a bounded secret on stdin and publishes only its project-bound reference", { timeout: 15000 }, async t => {
  const f = await fixture(t), secret = "controlled-mcp-stdin-secret";
  assert.equal((await f.apply({ type: "save", revision: 0, server })).revision, 1);
  const result = await f.run(["credential", "remote", "--project", f.project, "--revision", "1", "--stdin"], `${secret}\n`);
  assert.equal(result.code, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.equal(state.revision, 2); assert.equal(state.authentication.remote.state, "token");
  assert.equal(state.servers[0].enabled, false, "authentication must not enable a server or authorize a tool");
  assert.match(state.authentication.remote.ref, /^c_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(result).includes(secret), false);
  const file = path.join(f.config, "only-my-pi/mcp/credentials", `${state.authentication.remote.ref}.json`);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse((await f.run(["list", "--project", f.project])).stdout), state);
  assert.deepEqual(JSON.parse((await f.run(["status", "--project", f.project])).stdout).runs, []);
  const conflict = await f.run(["credential", "remote", "--project", f.project, "--revision", "1", "--stdin"], "replacement-secret\n");
  assert.equal(conflict.code, 1); assert.match(conflict.stderr, /MCP_REVISION_CONFLICT/);
  assert.equal(JSON.parse((await f.run(["list", "--project", f.project])).stdout).authentication.remote.ref, state.authentication.remote.ref);
});

test("CLI import requires the reviewed digest and explicit project enabling and logout preserve the default and raw source", { timeout: 15000 }, async t => {
  const f = await fixture(t), raw = path.join(f.root, "external.json");
  const original = JSON.stringify({ mcpServers: { remote: { type: "http", url: server.url } } });
  await fs.writeFile(raw, original);
  const previewResult = await f.run(["preview", raw]); assert.equal(previewResult.code, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout); assert.equal(preview.revision, 0); assert.equal(preview.servers[0].enabled, false);
  const imported = await f.run(["import", raw, "--revision", "0", "--digest", preview.digest]); assert.equal(imported.code, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).servers[0].source, "default");
  const enabled = await f.run(["enable", "remote", "--project", f.project, "--revision", "1"]); assert.equal(enabled.code, 0, enabled.stderr);
  assert.equal(JSON.parse(enabled.stdout).servers[0].enabled, true); assert.equal(JSON.parse(enabled.stdout).servers[0].source, "project");
  assert.equal(JSON.parse((await f.run(["list"])).stdout).servers[0].enabled, false);
  const login = await f.run(["credential", "remote", "--project", f.project, "--revision", "2", "--stdin"], "controlled-explicit-logout\n"); assert.equal(login.code, 0, login.stderr);
  const logout = await f.run(["logout", "remote", "--project", f.project, "--revision", "3"]); assert.equal(logout.code, 0, logout.stderr);
  assert.equal(JSON.parse(logout.stdout).authentication.remote.state, "revoked");
  const reset = await f.run(["reset", "remote", "--project", f.project, "--revision", "4"]); assert.equal(reset.code, 0, reset.stderr);
  assert.equal(JSON.parse(reset.stdout).servers[0].source, "default"); assert.equal(JSON.parse(reset.stdout).servers[0].enabled, false);
  assert.equal(await fs.readFile(raw, "utf8"), original);
  assert.deepEqual(JSON.parse((await f.run(["status"])).stdout).runs, []);
  await fs.writeFile(raw, original.replace("remote", "other"));
  const changed = await f.run(["import", raw, "--project", f.project, "--revision", "5", "--digest", preview.digest]);
  assert.equal(changed.code, 1); assert.match(changed.stderr, /MCP_IMPORT_CHANGED/);
  assert.equal(JSON.parse((await f.run(["list"])).stdout).revision, 5);
});

test("two real CLI writers cannot overwrite a concurrent revision and secret-bearing files or arguments remain rejected", { timeout: 15000 }, async t => {
  const f = await fixture(t), inputs = ["first", "second"].map(name => ({ type: "save", revision: 0, server: { ...server, name } }));
  const files = await Promise.all(inputs.map(async (input, index) => { const file = path.join(f.root, `writer-${index}.json`); await fs.writeFile(file, JSON.stringify(input)); return file; }));
  const results = await Promise.all(files.map(file => f.run(["apply", file, "--project", f.project])));
  assert.equal(results.filter(result => result.code === 0).length, 1);
  const failure = results.find(result => result.code !== 0); assert.match(failure.stderr, /MCP_REVISION_CONFLICT|LOCK_HELD/);
  const winner = JSON.parse(results.find(result => result.code === 0).stdout), state = JSON.parse((await f.run(["list", "--project", f.project])).stdout);
  assert.equal(state.revision, 1); assert.deepEqual(state.servers, winner.servers); assert.equal(state.servers.length, 1);
  const file = path.join(f.root, "secret-action.json"), secret = "controlled-rejected-secret";
  await fs.writeFile(file, JSON.stringify({ type: "credential", name: state.servers[0].name, envName: "MCP_TOKEN", value: secret, revision: 1 }));
  const rejected = await f.run(["apply", file, "--project", f.project]); assert.equal(rejected.code, 1); assert.match(rejected.stderr, /MCP_COMMAND_NOT_ADMITTED/);
  const argument = await f.run(["credential", state.servers[0].name, secret, "--project", f.project, "--revision", "1", "--stdin"]);
  assert.equal(argument.code, 1); assert.equal(JSON.stringify([rejected, argument]).includes(secret), false);
  const implicit = await f.run(["credential", state.servers[0].name, "--project", f.project, "--revision", "1"], `${secret}\n`);
  assert.equal(implicit.code, 1); assert.match(implicit.stderr, /MCP_SECRET_TTY_OR_STDIN_REQUIRED/);
  assert.equal(JSON.parse((await f.run(["list", "--project", f.project])).stdout).revision, 1);
  assert.deepEqual(JSON.parse((await f.run(["status"])).stdout).runs, []);
});
