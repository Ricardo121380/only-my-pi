import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";
import test from "node:test";

for (const scenario of ["approve", "revoke", "late", "cancel", "ordinary"]) {
  test(`actual Pi RPC + faux model + real tool: ${scenario}`, { timeout: 20000 }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-sdk-probe-"));
    const cwd = await fs.realpath(root);
    const config = path.join(cwd, "config");
    await fs.mkdir(config);
    execFileSync("/usr/bin/git", ["init", "-q", cwd]);
    const child = fork(new URL("./fixtures/host-sdk-probe.mjs", import.meta.url), [cwd, config, scenario], { silent: true, env: { PATH: process.env.PATH, HOME: cwd, PI_OFFLINE: "1", LANG: "en_US.UTF-8" } });
    t.after(async () => { if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } await fs.rm(root, { recursive: true, force: true }); });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = ""; child.stderr.on("data", (data) => { stderr += data; });
    const events = [];
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    let selected = 0;
    let settled;
    const completion = new Promise((resolve, reject) => { settled = resolve; child.once("exit", (code) => reject(new Error(`SDK exited ${code}: ${stderr}`))); });
    lines.on("line", async (line) => {
      const event = JSON.parse(line); events.push(event);
      if (event.type === "response" && event.id === "state") send({ id: "prompt", type: "prompt", message: "Execute fixture" });
      if (event.type === "extension_ui_request" && event.method === "select") {
        selected++;
        if (scenario === "late") { const reply = once(child, "message"); child.send("invalidate"); await reply; }
        if (scenario === "cancel") send({ id: "abort", type: "abort" });
        send({ type: "extension_ui_response", id: event.id, ...(scenario === "cancel" ? { cancelled: true } : { value: "Approve plan and allow coding for this session" }) });
      }
      if (event.type === "agent_settled") settled();
    });
    send({ id: "state", type: "get_state" });
    await completion;
    assert.equal(events.some((event) => event.type === "extension_error"), false, JSON.stringify(events.filter((e) => e.type === "extension_error")));
    const content = await fs.readFile(path.join(cwd, "proof.txt"), "utf8").catch(() => null);
    assert.equal(content, scenario === "approve" ? "real SDK tool\n" : null, JSON.stringify(events.filter((e) => e.type === "tool_execution_end")));
    assert.equal(selected, scenario === "ordinary" ? 0 : 1);
  });
}
