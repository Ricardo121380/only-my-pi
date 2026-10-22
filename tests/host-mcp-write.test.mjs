import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pty from "node-pty";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";
import { DirectSessionOwnership } from "../packages/direct-agent/ownership.mjs";
import { createHash } from "node:crypto";
import { createMcpHost, providerReply } from "./fixtures/mcp-host.mjs";
import { codingRequest } from "./fixtures/mcp-write-host.mjs";
import { createWriteHost as createIsolatedWriteHost, codingApproved, approveWrite, releaseWrite, terminal } from "./fixtures/mcp-write-host.mjs";
import { createSourceFixtureRoot } from "./fixtures/source-fixture-root.mjs";
import { until, untilPiInitialized, slowPiInitialization, mcpReception } from "./fixtures/mcp-host.mjs";
import { byteEvidence, errorEvidence, fileEvidence, observation, mcpDenialEvidence, processEvidence, saveRegressionEvidence } from "./fixtures/regression-evidence.mjs";
// Normal Host teardown confirms worker/MCP exit before removing this pathname.
// Recreate all data and sources; retain Pi's source-checked compilation cache.
// Independent TUI and intentional orphan journeys keep unique installations.
const createWriteHost = async (options) => createIsolatedWriteHost({ ...options, root: await createSourceFixtureRoot("omp-mcp-write-host-") });
const dispatched = async (f) => {
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  if (run.processes.some((entry) => !entry.runtimeDir)) return [];
  try { return await mcpReception(run); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
};
test("a lost Host stop receipt cannot leave the controlled fixture provider listening", { timeout: 15000 }, async (t) => {
  const f = await createMcpHost();
  const stop = f.host.stop;
  t.after(async () => { await stop(); await f.close().catch(() => {}); await fs.rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); });
  await stop();
  f.host.stop = async () => { throw Object.assign(new Error("FIXTURE_STOP_RECEIPT_LOST"), { code: "FIXTURE_STOP_RECEIPT_LOST" }); };
  await assert.rejects(f.close(), { code: "FIXTURE_STOP_RECEIPT_LOST" });
  await assert.rejects(fetch(f.providerOrigin));
  assert.ok((await fs.stat(f.root)).isDirectory(), "an unconfirmed close retains its fixture evidence");
});
// A real journey includes fixture/model preparation, up to 30s RPC startup,
// separate 7.5s approval/operation polls, and verified process cleanup.
const writeJourneyTimeout = 60000;
test("four authorities admit one actual descriptor write with truthful result identity", { timeout: writeJourneyTimeout }, async (t) => {
  const f = await createWriteHost({ mode: "gated" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  assert.equal(waiting.access, "coding"); assert.match(waiting.approvals[0].title, /写入/u);
  await approveWrite(f, waiting);
  await until(() => dispatched(f), entries => entries.some(entry => entry.type === "call"), "actual dispatch");
  await releaseWrite(f);
  await until(() => f.task(started.taskId), terminal, "write complete");
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "approved MCP file bytes\n");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 1);
  assert.ok(receipts.filter((entry) => entry.type === "startup-write").every((entry) => ["EPERM", "EACCES"].includes(entry.code)));
  assert.equal(run.calls[0].effect, "write"); assert.equal(run.calls[0].application, "applied"); assert.ok(run.calls[0].beforeDigest && run.calls[0].afterDigest); assert.equal(run.calls[0].verification, "not_run");
  assert.ok(run.processes.every((entry) => !entry.alive));
});

async function deniedWrites(t, { coding = false, slowStartup = false } = {}) {
  const answer = coding ? "拒绝" : null;
  const f = await createWriteHost({ coding });
  const mode = coding ? "controlled" : "readonly";
  const original = await fs.readFile(path.join(f.project, "README.md"));
  let started, lastTask, closed = false;
  const timing = { requestedAt: null, readyAt: null, deniedAt: null };
  const context = () => ({ coding, mode, answer, slowStartup, timing, taskId: started?.taskId, original: byteEvidence(original), lastTask });
  const close = async () => {
    if (closed) return;
    const before = await mcpDenialEvidence(f, { ...context(), phase: "before-cleanup" });
    const pids = [...new Set((before.mcp.value?.runs ?? []).flatMap(run => [run.ownerPid, ...run.processes.map(entry => entry.pid)]).concat(before.worker.value?.pid).filter(Number.isSafeInteger))];
    try { await f.close(); closed = true; await saveRegressionEvidence("mcp-cleanup", { root: f.root, ...context(), result: "closed", processes: await Promise.all(pids.map(processEvidence)) }); }
    catch (error) { await saveRegressionEvidence("mcp-cleanup", { root: f.root, ...context(), result: "UNKNOWN", error: errorEvidence(error) }); throw error; }
  };
  t.after(close);
  try {
    if (slowStartup) {
      // Fault injection stays at the copied public SDK factory. The actual
      // Host HTTP entry, Pi runtime, MCP receiver and policy remain in use.
      await slowPiInitialization(f.sdk);
    }
    timing.requestedAt = Date.now();
    started = await f.start({ mode });
    // startTask is asynchronous (202/starting). Its worker initialization
    // uses the existing 30s RPC readiness contract; denial keeps the original
    // 7.5s poll after initialization, including all original effect assertions.
    await untilPiInitialized(async () => lastTask = await f.task(started.taskId));
    timing.readyAt = Date.now();
    if (coding) await approveWrite(f, await codingApproved(f, started), answer);
    await until(async () => lastTask = await f.task(started.taskId), terminal, "unauthorized write denied");
    timing.deniedAt = Date.now();
    const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
    assert.equal(receipts.filter((entry) => entry.type === "call").length, 0); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 0);
    assert.deepEqual(await fs.readFile(path.join(f.project, "README.md")), original); assert.equal(run.calls[0].status, "rejected");
    assert.equal(run.calls[0].code, coding ? "MCP_CALL_DENIED" : "MCP_CODING_AUTHORITY_REQUIRED");
  } catch (error) {
    const snapshot = await mcpDenialEvidence(f, { ...context(), phase: "failure-before-cleanup", error: errorEvidence(error) });
    t.diagnostic(JSON.stringify({ coding, mode, answer, taskId: started?.taskId, task: snapshot.task, reception: snapshot.reception.status }));
    throw error;
  }
  await close();
}

for (const coding of [false, true]) test(`${coding ? "An unapproved MCP tool" : "Inspect"} cannot obtain real project write effects`, { timeout: writeJourneyTimeout }, t => deniedWrites(t, { coding }));
test("Inspect denial retains zero effects after a slow real Pi initialization", { timeout: 45000 }, t => deniedWrites(t, { slowStartup: true }));

for (const kind of ["symlink", "directory", "hardlink", "outside"]) test(`${kind} target reaches zero actual writes`, { timeout: writeJourneyTimeout }, async (t) => {
  const target = kind === "directory" ? "alias/file" : kind === "outside" ? "../outside" : "alias";
  const f = await createWriteHost({ target }); t.after(() => f.close());
  const outside = path.join(f.root, "outside"); await fs.writeFile(outside, "outside original");
  if (kind === "symlink") await fs.symlink(outside, path.join(f.project, "alias"));
  if (kind === "directory") { const dir = path.join(f.root, "other"); await fs.mkdir(dir); await fs.writeFile(path.join(dir, "file"), "outside original"); await fs.symlink(dir, path.join(f.project, "alias")); }
  if (kind === "hardlink") await fs.link(outside, path.join(f.project, "alias"));
  if (kind !== "outside") await f.mcp({ type: "save", revision: 1, server: { ...f.server, enabled: true, tools: [{ ...f.server.tools[0], paths: [kind === "directory" ? "alias" : target] }] } });
  const started = await f.start({ mode: "controlled" }), ended = await codingApproved(f, started);
  assert.equal(ended.approvals.length, 0); await until(() => f.task(started.taskId), terminal, "link denied");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => ["call", "effect"].includes(entry.type)).length, 0);
  assert.equal(await fs.readFile(outside, "utf8"), "outside original");
  if (kind === "directory") assert.equal(await fs.readFile(path.join(f.root, "other/file"), "utf8"), "outside original");
  await f.close();
});

test("target replaced while approval is pending invalidates that approval before writer startup", { timeout: writeJourneyTimeout }, async (t) => {
  const f = await createWriteHost(); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started), outside = path.join(f.root, "outside");
  await fs.writeFile(outside, "outside original"); await fs.rename(path.join(f.project, "README.md"), path.join(f.project, "saved")); await fs.symlink(outside, path.join(f.project, "README.md"));
  await approveWrite(f, waiting); await until(() => f.task(started.taskId), terminal, "changed target denied");
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  assert.equal(run.calls[0].code, "MCP_TARGET_CHANGED"); assert.equal((await mcpReception(run)).filter((entry) => entry.type === "call").length, 0);
  assert.equal(await fs.readFile(outside, "utf8"), "outside original"); assert.equal(await fs.readFile(path.join(f.project, "saved"), "utf8"), "temporary CLI project\n");
});

test("post-dispatch path replacement cannot redirect the pinned descriptor to an outside file", { timeout: 45000 }, async (t) => {
  const f = await createWriteHost({ mode: "gated" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  await approveWrite(f, waiting);
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  await until(() => dispatched(f), (entries) => entries.some((entry) => entry.type === "call"), "actual dispatch");
  const outside = path.join(f.root, "outside"); await fs.writeFile(outside, "outside original");
  await fs.rename(path.join(f.project, "README.md"), path.join(f.project, "saved")); await fs.symlink(outside, path.join(f.project, "README.md"));
  await releaseWrite(f);
  await until(() => f.task(started.taskId), terminal, "pinned write complete");
  const final = (await f.mcp({ type: "status" })).runs.find((entry) => entry.runId === run.runId);
  assert.equal(await fs.readFile(outside, "utf8"), "outside original"); assert.equal(await fs.readFile(path.join(f.project, "saved"), "utf8"), "approved MCP file bytes\n");
  assert.equal(final.calls[0].status, "unknown"); assert.equal(final.calls[0].observedChange, true);
});

test("actual mutation followed by receipt loss remains UNKNOWN and cannot auto replay", { timeout: 50000 }, async (t) => {
  const f = await createWriteHost({ mode: "crash", repeat: true }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting, "本任务");
  await until(() => f.task(started.taskId), terminal, "lost receipt");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 1);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "approved MCP file bytes\n");
  assert.equal(run.calls[0].status, "unknown"); assert.equal(run.calls[0].application, "unknown"); assert.equal(run.calls[0].observedChange, true);
  assert.equal(run.calls[1].code, "MCP_WRITE_RECONCILIATION_REQUIRED");
  await f.restart(); assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].status, "unknown");
  // A fresh worker may initialize after the 7.5s approval budget. Exercise
  // that real boundary after recovery, retaining the original approval poll.
  await slowPiInitialization(f.sdk, 8500);
  const next = await f.start({ mode: "controlled" });
  await untilPiInitialized(() => f.task(next.taskId));
  const pending = await until(() => f.task(next.taskId), (task) => task.approvals.length > 0, "new coding authority required");
  assert.equal(pending.access, "inspect");
  await f.request("/api/command", { type: "cancelTask", taskId: next.taskId }, 202);
});

for (const [action, delayedReceipt] of [["revokeTask", false], ["cancelTask", false], ["revokeTask", true]]) test(`actual dispatched write ${action} keeps effects truthful and stops service${delayedReceipt ? " with delayed shutdown receipt" : ""}`, { timeout: writeJourneyTimeout }, async (t) => {
  const f = await createWriteHost({ mode: "gated" }); t.after(() => f.close());
  if (delayedReceipt) {
    // Keep the real SDK, cleanup and IPC payload. Delay only this send to
    // expose process.exit racing a receipt still queued in the child.
    await fs.rename(f.sdk, path.join(path.dirname(f.sdk), "index-before-delayed-receipt.js"));
    await fs.writeFile(f.sdk, `export * from "./index-before-delayed-receipt.js";
      import { createAgentSessionServices as real } from "./index-before-delayed-receipt.js";
      export async function createAgentSessionServices(options) {
        const services = await real(options), send = process.send.bind(process);
        process.send = (message, ...args) => {
          if (message?.type !== "shutdown_confirmed") return send(message, ...args);
          setTimeout(() => send(message, ...args), 100); return false;
        };
        return services;
      }`);
  }
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting);
  await until(() => dispatched(f), (entries) => entries.some((entry) => entry.type === "call"), "actual dispatch");
  // Cross the former 2s window while the real service remains at the effect gate.
  await delay(2500);
  await f.request("/api/command", { type: action, taskId: started.taskId }, action === "cancelTask" ? 202 : 200);
  await until(() => f.task(started.taskId), terminal, "stopped write");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 0);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  assert.equal(run.calls[0].status, "unknown"); assert.ok(run.processes.every((entry) => !entry.alive));
});

test("startup descriptor effects are recorded UNKNOWN even when no tools/call is dispatched", { timeout: writeJourneyTimeout }, async (t) => {
  const f = await createWriteHost({ mode: "startup-effect" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting);
  await until(() => f.task(started.taskId), terminal, "startup effect");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 0); assert.equal(receipts.filter((entry) => entry.type === "startup-effect").length, 1);
  assert.equal(run.calls[0].status, "unknown"); assert.equal(run.calls[0].observedChange, true); assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "startup effect");
});

for (const cancelDuringRelease of [false, true]) test(`real terminal and Agent/MCP alternate the same canonical project ownership${cancelDuringRelease ? " with cancellation during release" : ""}`, { timeout: 35000 }, async (t) => {
  const f = await createWriteHost(); t.after(() => f.close());
  const manual = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 90, rows: 24 });
  await f.request("/api/command", { type: "writeTerminal", terminalId: manual.terminalId, seq: 1, data: "printf manual > terminal-proof.txt\r" });
  await until(async () => fs.readFile(path.join(f.project, "terminal-proof.txt"), "utf8").catch(() => null), (value) => value === "manual", "actual manual terminal effect");
  const blocked = await f.start({ mode: "controlled" }), failed = await until(() => f.task(blocked.taskId), terminal, "Agent blocked by terminal");
  assert.equal(failed.error, "OWNERSHIP_HELD"); assert.equal((await f.mcp({ type: "status" })).runs.length, 0);
  const closed = await f.request("/api/command", { type: "closeTerminal", terminalId: manual.terminalId }); assert.equal(closed.status, "closed");
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  const terminalConflict = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 90, rows: 24 }, 500); assert.equal(terminalConflict.code, "OWNERSHIP_HELD");
  const manualConflict = await f.request("/api/command", { type: "enterManual", projectId: f.projectId }, 500); assert.equal(manualConflict.code, "OWNERSHIP_HELD");
  await assert.rejects(new DirectSessionOwnership(f.config).acquire("project", f.project), { code: "OWNERSHIP_HELD" });
  // Hold each real lease release in turn: HTTP must not publish completion
  // while either the session or the canonical project is still owned.
  const releases = [f.host.tasks.leases, f.host.tasks.projectLeases].map((leases) => {
    const lease = leases.get(started.taskId), release = lease.release.bind(lease);
    let entered, unblock;
    const reached = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { unblock = resolve; });
    lease.release = async () => { entered(); await gate; return release(); };
    return { reached, unblock };
  });
  try {
    await approveWrite(f, waiting);
    for (const release of releases) {
      await release.reached;
      const visible = await f.task(started.taskId);
      assert.equal(terminal(visible), false, "task completion must wait for ownership release");
      await assert.rejects(new DirectSessionOwnership(f.config).acquire("project", f.project), { code: "OWNERSHIP_HELD" });
      if (cancelDuringRelease && release === releases[0]) {
        const cancelled = await f.request("/api/command", { type: "cancelTask", taskId: started.taskId }, 202);
        assert.equal(cancelled.status, "cancelling");
      }
      release.unblock();
    }
  } finally { for (const release of releases) release.unblock(); }
  const ended = await until(() => f.task(started.taskId), terminal, "Agent write complete");
  assert.equal(ended.status, cancelDuringRelease ? "cancelled" : "succeeded");
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "approved MCP file bytes\n");
  const owned = new DirectSessionOwnership(f.config); await owned.acquire("project", f.project); await owned.close();
});

async function tuiDescriptorWrite(t, { slowSelector = false } = {}) {
  const f = await createIsolatedWriteHost();
  const original = byteEvidence(await fs.readFile(path.join(f.project, "README.md")));
  const selectorTrace = path.join(f.root, "selector-events.jsonl");
  if (slowSelector) {
    // Delay only the private SDK's real selector entry, after the durable MCP
    // approval status but before Pi installs the focused input component.
    await fs.rename(f.sdk, path.join(path.dirname(f.sdk), "index-original.js"));
    await fs.writeFile(f.sdk, `export * from "./index-original.js";
import { InteractiveMode as RealMode } from "./index-original.js";
import fs from "node:fs";
const record = value => fs.appendFileSync(${JSON.stringify(selectorTrace)}, JSON.stringify({ at: Date.now(), ...value }) + "\\n");
export class InteractiveMode extends RealMode {
  async showExtensionSelector(title, options, opts, blocked) {
    if (!title.startsWith("MCP · local/write_file · 写入")) return super.showExtensionSelector(title, options, opts, blocked);
    record({ stage: "before-selector", title });
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = super.showExtensionSelector(title, options, opts, blocked);
    record({ stage: "selector-focused", focused: this.ui.focusedComponent === this.extensionSelector });
    const component = this.extensionSelector, handleInput = component.handleInput.bind(component);
    component.handleInput = data => { record({ stage: "selector-input", data }); return handleInput(data); };
    const answer = await result; record({ stage: "selector-answer", answer }); return answer;
  }
}`);
  }
  let output = "", exited, identity, lastMcp;
  const stages = [{ stage: "spawn", at: Date.now() }], keyWrites = [];
  const term = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 120, rows: 36 });
  const write = data => { keyWrites.push({ at: Date.now(), bytes: byteEvidence(data) }); term.write(data); };
  term.onData(data => { output += data; identity ??= processIdentity(term.pid); });
  term.onExit(exit => { exited = exit; stages.push({ stage: "exit", at: Date.now(), ...exit }); });
  const snapshot = async phase => {
    const mcp = await observation(() => f.mcp({ type: "status" }));
    if (mcp.status === "KNOWN") lastMcp = mcp.value;
    const reception = await Promise.all((mcp.value?.runs ?? []).flatMap(run => run.processes.map(async entry => {
      const raw = typeof entry.runtimeDir === "string" ? await fileEvidence(path.join(entry.runtimeDir, "received.jsonl")) : { status: "UNKNOWN", reason: "RECEIVER_PATH_UNAVAILABLE" };
      const counts = raw.status === "KNOWN" ? await observation(async () => {
        const rows = Buffer.from(raw.value.base64, "base64").toString().trim().split("\n").filter(Boolean).map(JSON.parse);
        return { call: rows.filter(row => row.type === "call").length, effect: rows.filter(row => row.type === "effect").length };
      }) : raw;
      return { runId: run.runId, process: entry, raw, counts };
    })));
    await saveRegressionEvidence("mcp-tui", { test: t.name, root: f.root, phase, slowSelector, stages, keyWrites, original, mcp, reception,
      readme: await fileEvidence(path.join(f.project, "README.md")), selectorTrace: await fileEvidence(selectorTrace), output: byteEvidence(output), exited: exited ?? null,
      process: await processEvidence(term.pid), providerRequests: f.requests.map(({ body }) => body) });
  };
  t.after(async () => {
    let clean = false;
    try {
      await snapshot("before-cleanup");
      if (!exited && groupAlive(term.pid)) {
        const expected = await identity;
        assert.ok(expected, "owned TUI cleanup identity is known");
        assert.equal(await processIdentity(term.pid), expected, "owned TUI cleanup identity");
        try { process.kill(-term.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      for (const entry of (lastMcp?.runs ?? []).flatMap(run => run.processes)) {
        if (groupAlive(entry.pid)) {
          assert.equal(await processIdentity(entry.pid), entry.identity, "owned MCP cleanup identity");
          try { process.kill(-entry.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      }
      await until(() => exited && !groupAlive(term.pid) && (lastMcp?.runs ?? []).every(run => run.processes.every(entry => !groupAlive(entry.pid))), Boolean, "owned TUI and MCP fixture exit", 2000);
      clean = true;
    } finally {
      try { await f.close({ keep: !clean }); }
      finally { await saveRegressionEvidence("mcp-tui-cleanup", { test: t.name, root: f.root, clean, exited: exited ?? null, process: await processEvidence(term.pid) }); }
    }
  });
  try {
    await until(() => output, value => value.includes("Inspect") || exited, "TUI ready", 30000); assert.equal(exited, undefined, output);
    identity = await identity; stages.push({ stage: "Inspect", at: Date.now() });
    write("MCP write probe\r");
    await until(() => output, value => value.includes("Approve") || exited, "coding approval");
    const approvalOutput = output.length;
    write("\r");
    lastMcp = await until(() => f.mcp({ type: "status" }), state => state.runs.at(-1)?.calls[0]?.status === "awaiting_approval", "TUI MCP approval");
    stages.push({ stage: "journal-awaiting-approval", at: Date.now() });
    // The persisted approval journal precedes selector focus and terminal output.
    // Drive the actual visible dialog before sending the original combined keys.
    await until(() => output.slice(approvalOutput), value => value.includes("MCP · local/write_file · 写入") && value.includes("拒绝") && value.includes("仅本次") && value.includes("本任务"), "visible MCP write selector");
    stages.push({ stage: "visible-selector", at: Date.now() });
    write("\x1b[B\r");
    await until(async () => fs.readFile(path.join(f.project, "README.md"), "utf8"), value => value === "approved MCP file bytes\n", "actual CLI descriptor effect");
    await until(() => f.mcp({ type: "status" }), state => state.runs.at(-1).status === "stopped", "TUI task stopped");
    const run = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(run.calls[0].application, "applied"); assert.equal((await mcpReception(run)).filter(entry => entry.type === "call").length, 1);
    if (slowSelector) {
      const events = (await fs.readFile(selectorTrace, "utf8")).trim().split("\n").map(JSON.parse);
      const before = events.find(event => event.stage === "before-selector"), focused = events.find(event => event.stage === "selector-focused");
      assert.ok(focused.at > before.at); assert.equal(focused.focused, true);
      assert.ok(stages.find(stage => stage.stage === "journal-awaiting-approval").at < focused.at, "approval journal is readable before selector focus");
      assert.equal(events.find(event => event.stage === "selector-answer").answer, "仅本次");
    }
    write("\x04"); await until(() => exited, Boolean, "TUI normal exit"); assert.equal(exited.exitCode, 0);
  } catch (error) {
    stages.push({ stage: "failure", at: Date.now(), error: errorEvidence(error) });
    await snapshot("failure-before-cleanup");
    throw error;
  }
}

test("actual CLI TUI writes through the shared approval and physical descriptor contract", { timeout: 45000 }, tuiDescriptorWrite);
test("actual CLI TUI waits for the focused MCP write selector after its approval journal is visible", { timeout: 45000 }, t => tuiDescriptorWrite(t, { slowSelector: true }));

test("MCP approval cannot repair a lost real Host project owner token", { timeout: writeJourneyTimeout }, async (t) => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const f = await createWriteHost({ respond: async ({ body, res }) => {
    const count = body.messages.filter((message) => message.role === "tool").length;
    if (count > 1) await gate;
    providerReply(res, count === 0 ? "request_coding_access" : count === 1 ? "mcp__local__write_file" : null, count === 0 ? codingRequest : { path: "README.md", text: "unowned effect" });
  } });
  let ownerFile, original;
  t.after(async () => { if (original) await fs.writeFile(ownerFile, original); release(); await f.close(); });
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  const digest = createHash("sha256").update(f.project).digest("hex"); ownerFile = path.join(f.config, "only-my-pi/host/locks", `project-${digest}`, "owner.json");
  original = await fs.readFile(ownerFile); await fs.writeFile(ownerFile, JSON.stringify({ ...JSON.parse(original), token: "lost-fixture-token" }));
  await approveWrite(f, waiting);
  const run = await until(async () => (await f.mcp({ type: "status" })).runs.at(-1), (entry) => entry.calls[0]?.status === "rejected", "owner proof denied");
  assert.equal(run.calls[0].code, "OWNERSHIP_LOST"); assert.equal((await mcpReception(run)).filter((entry) => entry.type === "call").length, 0);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  await fs.writeFile(ownerFile, original); original = null; release(); await until(() => f.task(started.taskId), terminal, "failed call settled");
});

test("crashed coding owner keeps real MCP residual effects UNKNOWN and project ownership blocked", { timeout: 30000 }, async (t) => {
  const f = await createIsolatedWriteHost({ mode: "orphan" });
  const { groupAlive, processIdentity } = await import("../packages/host/ownership.mjs");
  let run;
  t.after(async () => {
    if (run) { for (const entry of run.processes) if (groupAlive(entry.pid) && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL"); await until(() => run.processes.every((entry) => !groupAlive(entry.pid)), Boolean, "owned orphan cleanup"); }
    await f.close({ unconfirmed: true });
  });
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting);
  await until(() => dispatched(f), (entries) => entries.some((entry) => entry.type === "call"), "actual dispatched orphan");
  run = (await f.mcp({ type: "status" })).runs.at(-1); process.kill(run.ownerPid, "SIGKILL");
  const ended = await until(() => f.task(started.taskId), terminal, "coding owner crash"); assert.equal(ended.error, "RPC_TERMINATION_UNCONFIRMED");
  await until(async () => fs.readFile(path.join(f.project, "README.md"), "utf8"), (value) => value === "approved MCP file bytes\n", "residual authorized descriptor effect");
  const orphan = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(orphan.status, "reconciliation"); assert.equal(orphan.calls[0].status, "unknown"); assert.ok(orphan.processes.some((entry) => entry.alive));
  assert.equal(orphan.calls[0].application, "unknown"); assert.equal(orphan.calls[0].observedChange, undefined); assert.equal(orphan.calls[0].verification, "not_run");
  const ledgerFile = path.join(f.config, "only-my-pi/mcp/runs.json"), ledger = JSON.parse(await fs.readFile(ledgerFile, "utf8"));
  assert.equal(ledger.runs.at(-1).calls[0].application, "unknown", "writer startup is durably uncertain before the owner can crash");
  ledger.runs.at(-1).calls[0].application = "not_applied";
  await fs.writeFile(ledgerFile, JSON.stringify(ledger));
  assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].application, "unknown", "legacy dispatched writes are projected as uncertain without rewriting history");
  assert.equal(JSON.parse(await fs.readFile(ledgerFile, "utf8")).runs.at(-1).calls[0].application, "not_applied");
  await assert.rejects(new DirectSessionOwnership(f.config).acquire("project", f.project), { code: "OWNERSHIP_HELD" });
  const received = await mcpReception(orphan); assert.equal(received.filter((entry) => entry.type === "call").length, 1); assert.equal(received.filter((entry) => entry.type === "effect").length, 1);
});

// Each independent scenario owns a real Pi startup, cleanup and 45s deadline.
for (const [mode, name] of [
  ["list-change", "changed write schema invalidates discovered write authority"],
  ["credential-revoke", "revoked credentials invalidate pending write authority"],
]) test(name, { timeout: 45000 }, async (t) => {
  const f = await createWriteHost({ mode: mode === "list-change" ? mode : undefined }); t.after(() => f.close());
  if (mode === "credential-revoke") await f.mcp({ type: "credential", revision: 1, name: "local", envName: "MCP_TOKEN", value: "synthetic-write-credential" });
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  if (mode === "credential-revoke") {
    await f.mcp({ type: "revokeCredential", revision: 2, name: "local", envName: "MCP_TOKEN" });
    await approveWrite(f, waiting);
  } else assert.equal(waiting.approvals.length, 0);
  await until(() => f.task(started.taskId), terminal, "changed write authority rejected");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call" || entry.type === "effect").length, 0);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  assert.ok(!JSON.stringify(await f.task(started.taskId)).includes("synthetic-write-credential"));
  await f.close();
});
