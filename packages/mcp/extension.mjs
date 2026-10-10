import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import { McpCatalog, MCP_LIMITS, digest, mcpError, mcpToolName } from "./catalog.mjs";
import { McpRuns } from "./runs.mjs";
import { ControlledStdioTransport, launchIdentity } from "./process.mjs";
import { processIdentity } from "../host/ownership.mjs";
import { loadNativeMcp } from "./native.mjs";

const result = (code) => ({ content: [{ type: "text", text: code }], details: { status: code } });
async function selectedPath(project, value, scopes) {
  if (typeof value !== "string" || !value || value.length > 512 || path.isAbsolute(value) || /[\0\\]/u.test(value) || value.split("/").some((entry) => ["..", ".git", ".pi"].includes(entry))) throw mcpError("MCP_PATH_DENIED");
  const target = await fs.realpath(path.resolve(project, value));
  if (!target.startsWith(project + path.sep)) throw mcpError("MCP_PATH_DENIED");
  const allowed = await Promise.all(scopes.map((entry) => fs.realpath(path.resolve(project, entry))));
  if (!allowed.some((entry) => target === entry || target.startsWith(entry + path.sep))) throw mcpError("MCP_PATH_DENIED");
  const stat = await fs.stat(target); if (!stat.isFile() || stat.size > MCP_LIMITS.outputBytes) throw mcpError("MCP_FILE_LIMIT");
  return target;
}

// Loaded only by audited omp-direct. Pi owns tools, UI and Agent execution;
// its native MCP client owns protocol semantics. OMP owns admission and state.
export function installOmpMcp(pi, { configRoot, controller }) {
  const catalog = new McpCatalog(configRoot), store = new McpRuns(configRoot), connections = new Map(), processes = new Set(), grants = new Set(), parents = new Map();
  let snapshot, run, McpClient, busy = false, revoked = false, closing = false, monitor, saved = Promise.resolve(), tui = false, cleanupConfirmed = true, generation = 0;
  pi.events.on("only-my-pi:mcp-task:v1", (payload) => { snapshot = payload.snapshot; });
  const save = () => { const copy = structuredClone(run); saved = saved.catch(() => {}).then(() => store.save(copy)); return saved; };
  const tools = () => [...connections.values()].flatMap((entry) => entry.names);
  pi.events.emit("only-my-pi:owned-mcp:v1", { admits: (name) => !closing && !revoked && tools().includes(name) });
  const check = async (server) => {
    if (revoked || closing || !await catalog.current(server)) throw mcpError("MCP_AUTHORIZATION_REVOKED", 409);
    const credentials = await catalog.credentials(server, snapshot.projectPath);
    if (digest(credentials.env) !== connections.get(server.name).credentialDigest) throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED", 409);
  };
  const stop = async () => {
    closing = true; grants.clear(); clearInterval(monitor);
    cleanupConfirmed = false;
    const outcomes = await Promise.allSettled([...processes].map(async (entry) => {
      entry.disarm?.(); const closed = await Promise.allSettled([entry.client.close(), entry.transport.close()]);
      if (closed.some((outcome) => outcome.status === "rejected")) throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
    }));
    if (run) {
      for (const call of run.calls) if (call.status === "dispatched") call.status = "unknown";
      run.status = outcomes.some((entry) => entry.status === "rejected") ? "reconciliation" : "stopped"; await save();
    }
    if (outcomes.some((entry) => entry.status === "rejected")) throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
    cleanupConfirmed = true;
  };
  const connect = async (server, files, credentials, readPaths, callId = null, signal) => {
    if (closing || revoked) throw mcpError("MCP_AUTHORIZATION_REVOKED");
    const record = { server: server.name, targetDigest: server.targetDigest, callId, kind: callId ? "read" : "discovery", pid: null, status: "starting" };
    const transport = new ControlledStdioTransport({ server, files, readPaths, configRoot, ...credentials, record, save });
    const client = new McpClient({ name: "only-my-pi", version: "1", requestTimeoutMs: MCP_LIMITS.timeoutMs });
    const connection = { client, transport, record, changed: false };
    if (signal) {
      if (signal.aborted) throw mcpError("MCP_CALL_CANCELLED");
      const abort = () => { void client.close().catch(() => {}); void transport.close().catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true }); connection.disarm = () => signal.removeEventListener("abort", abort);
    }
    processes.add(connection); run.processes.push(record); await save();
    transport.cwd = await fs.realpath(path.resolve(snapshot.projectPath, server.cwd ?? "."));
    if (transport.cwd !== snapshot.projectPath && !transport.cwd.startsWith(snapshot.projectPath + path.sep)) throw mcpError("MCP_CWD_NOT_ADMITTED");
    client.onNotification("notifications/tools/list_changed", () => { connection.changed = true; grants.clear(); });
    await client.connect(transport);
    // sandbox-exec legitimately changes comm during exec. The completed MCP
    // handshake pins the server lifetime after that transition.
    transport.record.identity = await processIdentity(transport.record.pid);
    await save(); return connection;
  };
  const call = async (server, policy, initial, toolCallId, params, signal, ctx) => {
    const entry = connections.get(server.name);
    if (typeof toolCallId !== "string" || !toolCallId || toolCallId.length > 256) return result("MCP_CALL_ID_INVALID");
    if (run.calls.some((call) => call.toolCallId === toolCallId)) return result("MCP_CALL_ALREADY_RECORDED");
    const record = { callId: randomUUID(), toolCallId, parentToolCallId: parents.get(toolCallId) ?? null, taskId: run.taskId, server: server.name, tool: policy.name, targetDigest: server.targetDigest, revision: snapshot.revision, definitionDigest: digest(initial), inputDigest: digest(params), status: "checking", startedAt: new Date().toISOString() };
    if (run.calls.length >= MCP_LIMITS.calls || busy) return result("MCP_CALL_LIMIT");
    busy = true; run.calls.push(record); let execution;
    try {
      if (Buffer.byteLength(JSON.stringify(params)) > MCP_LIMITS.inputBytes) throw mcpError("MCP_INPUT_LIMIT");
      await check(server);
      const current = (await entry.client.listTools({ signal, timeoutMs: MCP_LIMITS.timeoutMs })).find((tool) => tool.name === policy.name);
      if (entry.changed || !current || digest(current) !== record.definitionDigest) throw mcpError("MCP_TOOL_DEFINITION_CHANGED");
      if (!new Ajv({ strict: false }).compile(current.inputSchema)(params)) throw mcpError("MCP_ARGUMENTS_INVALID");
      record.target = await selectedPath(snapshot.projectPath, params[policy.pathArgument], policy.paths);
      const key = digest([server.targetDigest, record.definitionDigest, record.target, snapshot.revision]);
      if (!grants.has(key)) {
        record.status = "awaiting_approval"; await save();
        if (!ctx.hasUI) throw mcpError("MCP_APPROVAL_REQUIRED");
        const choice = await ctx.ui.select(`MCP · ${server.name}/${policy.name} · 只读\n${record.target}\n配置版本 ${snapshot.revision} · 仅允许声明路径 · 10 秒 / 16 KiB 输入 / 64 KiB 输出`, ["拒绝", "仅本次", "本任务"]);
        if (!["仅本次", "本任务"].includes(choice)) throw mcpError("MCP_CALL_DENIED");
        await check(server);
        if (signal?.aborted) throw mcpError("MCP_CALL_CANCELLED");
        if (choice === "本任务") grants.add(key);
        record.authorization = choice === "本任务" ? "task" : "once";
      } else record.authorization = "task";
      if (digest(await launchIdentity(server)) !== digest(entry.files)) throw mcpError("MCP_CODE_IDENTITY_CHANGED");
      if (await selectedPath(snapshot.projectPath, params[policy.pathArgument], policy.paths) !== record.target) throw mcpError("MCP_TARGET_CHANGED");
      const timeout = AbortSignal.timeout(MCP_LIMITS.timeoutMs), callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      execution = await connect(server, entry.files, await catalog.credentials(server, snapshot.projectPath), [record.target], record.callId, callSignal);
      const fresh = (await execution.client.listTools({ signal: callSignal, timeoutMs: MCP_LIMITS.timeoutMs })).find((tool) => tool.name === policy.name);
      if (!fresh || digest(fresh) !== record.definitionDigest || execution.changed || entry.changed) throw mcpError("MCP_TOOL_DEFINITION_CHANGED");
      execution.transport.beforeToolCall = async () => {
        await check(server);
        if (callSignal.aborted || execution.changed || entry.changed) throw mcpError("MCP_AUTHORIZATION_REVOKED");
        if (await selectedPath(snapshot.projectPath, params[policy.pathArgument], policy.paths) !== record.target) throw mcpError("MCP_TARGET_CHANGED");
      };
      record.status = "dispatched"; await save();
      await check(server);
      const output = await execution.client.callTool(policy.name, { ...params, [policy.pathArgument]: record.target }, { signal: callSignal, timeoutMs: MCP_LIMITS.timeoutMs });
      if (Buffer.byteLength(JSON.stringify(output)) > MCP_LIMITS.outputBytes || !Array.isArray(output.content) || output.content.some((block) => block.type !== "text" || typeof block.text !== "string")) throw mcpError("MCP_RESULT_NOT_ADMITTED");
      await execution.client.close(); await execution.transport.close();
      record.status = output.isError ? "failed" : "completed"; record.completedAt = new Date().toISOString(); await save();
      return { content: output.content, details: { callId: record.callId, status: record.status, revision: record.revision, server: server.name, tool: policy.name } };
    } catch (error) {
      record.code = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_CALL_FAILED";
      record.status = record.status === "dispatched" ? "unknown" : "rejected"; await save();
      return result(`${record.code}${record.status === "unknown" ? ": 结果未知，不自动重试" : ""}`);
    } finally {
      if (execution) { execution.disarm?.(); await execution.client.close().catch(() => {}); await execution.transport.close().catch(() => {}); }
      busy = false;
    }
  };
  const startTask = async (ctx) => {
    const projectPath = await fs.realpath(ctx.cwd);
    if (tui) {
      if (!cleanupConfirmed) throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
      snapshot = await catalog.snapshot(projectPath); connections.clear(); processes.clear(); parents.clear(); run = undefined;
      revoked = false; closing = false; generation++;
    } else snapshot ??= await catalog.snapshot(projectPath);
    if (snapshot.projectPath !== projectPath) throw mcpError("MCP_PROJECT_BINDING_CHANGED");
    controller.mcpTools = tools; controller.applyToolCeiling();
    const selected = snapshot.servers.filter((server) => server.enabled);
    if (!selected.length) return;
    run = await store.begin({ taskId: process.env.OMP_HOST_INPUT_TASK_ID ?? `cli_${randomUUID()}`, projectPath, revision: snapshot.revision });
    cleanupConfirmed = false;
    try {
    ({ McpClient } = await loadNativeMcp(process.env.OMP_MCP_SDK_FILE));
    for (const server of selected) {
      const files = await launchIdentity(server), credentials = await catalog.credentials(server, projectPath);
      const discovery = await connect(server, files, credentials, []);
      const entry = { ...discovery, server, files, credentialDigest: digest(credentials.env), names: [] }; connections.set(server.name, entry);
      // Share the notification flag rather than a stale copied boolean.
      entry.client.onNotification("notifications/tools/list_changed", () => { entry.changed = true; grants.clear(); });
      const available = await entry.client.listTools({ signal: AbortSignal.timeout(MCP_LIMITS.timeoutMs) }); if (available.length > MCP_LIMITS.tools) throw mcpError("MCP_TOOL_LIMIT");
      for (const policy of server.tools) {
        const tool = available.find((entry) => entry.name === policy.name); if (!tool) throw mcpError("MCP_TOOL_NOT_FOUND");
        const name = mcpToolName(server.name, policy.name); entry.names.push(name);
        pi.registerTool({ name, label: `${server.name}/${policy.name}`, description: `OMP 受控只读工具；每次调用检查授权和路径。${tool.description ?? ""}`, parameters: tool.inputSchema, executionMode: "sequential",
          execute: (toolCallId, params, signal, _onUpdate, ctx) => call(server, policy, tool, toolCallId, params, signal, ctx) });
      }
    }
    controller.applyToolCeiling();
    const monitored = generation;
    monitor = setInterval(() => { void Promise.all([...connections.values()].map(({ server }) => check(server))).catch(async () => { if (generation === monitored) { revoked = true; await stop().catch(() => {}); } }); }, 200); monitor.unref();
    if (process.connected) process.send({ type: "mcp_initialized", clean: true }, () => {});
    } catch (error) {
      await stop().catch(() => {});
      if (process.connected) process.send({ type: "mcp_initialized", clean: false, code: /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_START_FAILED" }, () => {});
      throw error;
    }
  };
  pi.on("session_start", async (_event, ctx) => {
    tui = ctx.mode === "tui";
    if (!tui) await startTask(ctx);
  });
  // A TUI conversation contains many user tasks. Pi's public post-bind tool
  // registration refreshes the next request without inheriting old grants.
  pi.on("before_agent_start", async (_event, ctx) => { if (tui) await startTask(ctx); });
  // All exposure paths execute the same registered handler. An extension's
  // extra MCP registration never creates a connection or receives a grant.
  pi.on("tool_call", (event) => {
    if (!event.toolName.startsWith("mcp__")) return;
    if (!tools().includes(event.toolName)) return { block: true, reason: "MCP_SERVER_NOT_ADMITTED" };
    if (event.parentToolCallId && (typeof event.parentToolCallId !== "string" || event.parentToolCallId.length > 256)) return { block: true, reason: "MCP_CALL_ID_INVALID" };
    parents.set(event.toolCallId, event.parentToolCallId ?? null);
  });
  pi.on("agent_end", async () => { grants.clear(); if (tui) await stop(); });
  pi.on("session_shutdown", stop);
  const receive = async (message) => {
    if (!["mcp_revoke", "mcp_prepare_shutdown"].includes(message?.type) || typeof message.id !== "string") return;
    revoked = true; await stop().catch(() => {});
    if (process.connected) process.send({ type: "mcp_stopped", id: message.id, clean: !run || cleanupConfirmed }, () => {});
  };
  process.on("message", receive);
  pi.on("session_shutdown", () => process.off("message", receive));
  return { tools, stop, clean: () => !run || cleanupConfirmed };
}
