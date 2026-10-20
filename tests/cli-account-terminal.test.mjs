import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import pty from "node-pty";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { createAccountOAuthService, installAccountOAuthTransport } from "./fixtures/account-oauth-service.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";

const execFile = promisify(execFileCallback);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function until(read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail(`PTY condition not reached: ${label}`);
}
function reply(res, name, args) {
  const delta = name ? { role: "assistant", tool_calls: [{ index: 0, id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } : { role: "assistant", content: "controlled coding completed" };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: name ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: "controlled", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

for (const authType of ["api_key", "oauth"]) test(`actual PTY independently sets up ${authType}, protects native auth entrypoints and requires coding approval`, { timeout: 120000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-pty-")));
  const access = { taskSummary: "Controlled account coding", complexity: "simple", scope: ["proof.txt"], riskFlags: [], verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const service = await createAccountOAuthService({ respond: ({ body, res }) => {
    const lastUser = body.messages.findLastIndex(message => message.role === "user");
    const steps = body.messages.slice(lastUser + 1).filter(message => message.role === "tool").length;
    if (!steps) reply(res, "request_coding_access", access);
    else if (steps === 1) reply(res, "write", { path: "proof.txt", content: "controlled product account\n" });
    else reply(res);
  } });
  const f = await createPi110SourceCli(root, { baseUrl: `${service.origin}/v1`, installedExtensions: true, verifyNode: true });
  if (authType === "oauth") await installAccountOAuthTransport(f, service);
  const key = "controlled-pty-secret-do-not-echo";
  if (authType === "api_key") service.keys.set(key, authType);
  const descriptor = path.join(root, "provider.json");
  await fs.writeFile(descriptor, JSON.stringify({ baseUrl: `${service.origin}/v1`, api: "openai-completions", models: [{ id: "controlled-model", name: "Controlled", contextWindow: 32000, maxTokens: 128 }] }));
  const originalAuth = await fs.readFile(path.join(f.config, "auth.json"));
  const shell = pty.spawn("/bin/sh", ["-i"], { cwd: f.project, env: { ...f.cliEnv, PS1: "OMP_SHELL> " }, cols: 120, rows: 38 });
  let output = "", exited, shellIdentity;
  shell.onData(chunk => { output += chunk; }); shell.onExit(event => { exited = event; });
  const commands = [];
  let stage = 0;
  const command = args => {
    const mark = `CLIENT_STAGE_${++stage}_`;
    commands.push({ args, mark });
    shell.write(`${[process.execPath, f.cli, ...args].map(quote).join(" ")}; printf '\\n${mark}%s\\n' "$?"\r`);
    return mark;
  };
  const completed = async (mark, code = 0) => {
    await until(() => output, text => text.includes(`${mark}${code}\r\n`), mark);
  };
  // A PTY is a byte stream: wait for the entire stty reply before queuing
  // another shell command whose echo could otherwise interrupt that reply.
  const terminalSetting = label => output.slice(0, output.lastIndexOf("\n") + 1)
    .split(/[\r\n]+/).find(line => line.startsWith(`${label}=`))?.slice(label.length + 1);
  t.after(async () => {
    try {
      if (!exited && shellIdentity && await processIdentity(shell.pid) === shellIdentity) process.kill(-shell.pid, "SIGKILL");
      for (let i = 0; i < 100 && (!exited || groupAlive(shell.pid)); i++) await new Promise(resolve => setTimeout(resolve, 25));
      await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01A_SOURCE_PTY_LOCAL_ONLY", bindings: f.bindings, nodeRuntime: f.nodeRuntime,
        authType, commands, transcript: output, shellExit: exited ?? null, processGroupGone: !groupAlive(shell.pid), received: service.calls, exchanges: service.exchanges });
      assert.ok(exited && !groupAlive(shell.pid), "actual PTY process group must fully exit before fixture cleanup");
    } finally { await service.close(); await fs.rm(root, { recursive: true }); }
  });
  await until(() => output, text => text.includes("OMP_SHELL> "), "isolated shell");
  shellIdentity = await processIdentity(shell.pid);
  shell.write("printf 'CLIENT_STTY_BEFORE='; stty -g\r");
  await until(() => terminalSetting("CLIENT_STTY_BEFORE"), Boolean, "complete original terminal settings");
  const addMark = command(["account", "add", "--provider", "openrouter", "--name", `PTY ${authType}`, "--auth", authType]);
  await completed(addMark);
  const accountId = /"accountId":\s*"([0-9a-f-]{36})"/.exec(output)?.[1]; assert.ok(accountId);
  await completed(command(["account", "configure", accountId, descriptor]));
  // Cancel a real authentication interaction, then retry without restoring a
  // permission, key or callback from the cancelled operation.
  const cancelOffset = output.length, cancelMark = command(["account", "login", accountId]);
  await until(() => output.slice(cancelOffset), text => authType === "api_key" ? text.includes("API Key (hidden") : text.includes("Open in your browser:"), "authentication interaction");
  shell.write("\x03"); await completed(cancelMark, 1);
  assert.equal(JSON.parse((await execFile(process.execPath, [f.cli, "account", "status", accountId], { cwd: f.project, env: f.cliEnv })).stdout).status, "missing");
  assert.equal(service.exchanges.length, 0);
  const loginOffset = output.length, loginMark = command(["account", "login", accountId]);
  await until(() => output.slice(loginOffset), text => authType === "api_key" ? text.includes("API Key (hidden") : text.includes("Open in your browser:"), "retry authentication");
  await assert.rejects(execFile(process.execPath, [f.cli, "account", "rename", accountId, "Cannot race login"], { cwd: f.project, env: f.cliEnv }), error => /ACCOUNT_BUSY/.test(error.stderr));
  if (authType === "api_key") shell.write(`${key}\r`);
  else {
    const url = /Open in your browser: (https:\/\/[^\s]+)/.exec(output.slice(loginOffset))[1];
    const authorized = await fetch(service.authorizeUrl(url, authType), { redirect: "manual" });
    assert.equal((await fetch(authorized.headers.get("location"))).status, 200);
  }
  await completed(loginMark);
  assert.equal(output.includes(key), false);
  const listOffset = output.length;
  await completed(command(["account", "list"]));
  assert.ok(output.slice(listOffset).includes(accountId));
  assert.match(output.slice(listOffset), /"source":\s*"product"/);
  assert.match(output.slice(listOffset), /"source":\s*"original_pi"/);
  const statusOffset = output.length;
  await completed(command(["account", "status", accountId]));
  assert.match(output.slice(statusOffset), /"status":\s*"stored"/);
  const modelsOffset = output.length;
  await completed(command(["account", "models", accountId]));
  assert.match(output.slice(modelsOffset), /"id":\s*"openrouter\/controlled-model"/);
  const tuiOffset = output.length;
  const tuiMark = command(["--account", accountId, "--model", "openrouter/controlled-model", "--tui-mode", "regular"]);
  await until(() => output.slice(tuiOffset), text => text.includes("[Extensions]") && text.lastIndexOf("OMP · Inspect") > text.indexOf("[Extensions]"), "real Pi initialization and Inspect editor");
  assert.equal(service.calls.length, 0, "login and startup grant no model or coding permission");
  const logoutOffset = output.length;
  shell.write("/logout\r");
  await until(() => output.slice(logoutOffset), text => /OpenRouter|openrouter/.test(text), "native logout selector");
  shell.write("\r");
  await until(() => output.slice(logoutOffset), text => text.includes("ACCOUNT_AUTH_REQUIRES_ACCOUNT_COMMAND"), "native logout cannot bypass account coordination");
  const status = JSON.parse((await execFile(process.execPath, [f.cli, "account", "status", accountId], { cwd: f.project, env: f.cliEnv })).stdout);
  assert.equal(status.status, "stored");
  const nativeLoginOffset = output.length;
  shell.write("/login openrouter\r");
  await until(() => output.slice(nativeLoginOffset), text => text.includes("Sign in with OpenRouter"), "native login method selector");
  shell.write("\r");
  await until(() => output.slice(nativeLoginOffset), text => text.includes("ACCOUNT_AUTH_REQUIRES_ACCOUNT_COMMAND"), "native login cannot overwrite a product account");
  shell.write("controlled coding\r");
  await until(() => output.slice(tuiOffset), text => text.includes("Approve plan and allow coding for this session"), "coding approval");
  assert.equal(service.calls.length, 1);
  await assert.rejects(fs.access(path.join(f.project, "proof.txt")), { code: "ENOENT" });
  await assert.rejects(execFile(process.execPath, [f.cli, "account", "logout", accountId], { cwd: f.project, env: f.cliEnv }), error => /ACCOUNT_BUSY/.test(error.stderr));
  shell.write("\r");
  await until(() => output.slice(tuiOffset), text => text.includes("controlled coding completed"), "approved real file write");
  assert.equal(await fs.readFile(path.join(f.project, "proof.txt"), "utf8"), "controlled product account\n");
  assert.equal(service.calls.length, 3); assert.ok(service.calls.every(call => call.valid && call.identity === authType));
  shell.write("\x04"); await completed(tuiMark);
  shell.write("printf 'CLIENT_STTY_AFTER='; stty -g\r");
  await until(() => terminalSetting("CLIENT_STTY_AFTER"), Boolean, "same terminal restored");
  assert.equal(terminalSetting("CLIENT_STTY_BEFORE"), terminalSetting("CLIENT_STTY_AFTER"));
  await completed(command(["account", "rename", accountId, "Released after exit"]));
  assert.deepEqual(await fs.readFile(path.join(f.config, "auth.json")), originalAuth);
  for (const secret of service.keys.keys()) assert.equal(output.includes(secret), false);
  shell.write("exit\r"); await until(() => exited, Boolean, "shell exited");
});
