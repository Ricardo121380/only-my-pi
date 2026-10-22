import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";
import { McpCatalog, MCP_LIMITS, MCP_HELPERS, digest, mcpError, mcpToolName, mcpToolEnabled, resourceUri } from "./catalog.mjs";
import { McpRuns } from "./runs.mjs";
import { ControlledStdioTransport, containsSecret, launchIdentity } from "./process.mjs";
import { processIdentity } from "../host/ownership.mjs";
import { loadNativeMcp } from "./native.mjs";
import { openWriteTarget } from "./write-target.mjs";
import { ControlledHttpTransport } from "./http.mjs";
import { discoverClient, admittedResources, resourceContent } from "./discovery.mjs";

const result = (code) => ({ isError: true, content: [{ type: "text", text: code }], details: { status: code } });
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
  let snapshot, pendingSnapshot, run, McpClient, NativeHttpTransport, busy = false, revoked = false, closing = false, monitor, saved = Promise.resolve(), tui = false, cleanupConfirmed = true, generation = 0, discoveryAttempts = 0, helpersInstalled = false;
  const helpers = MCP_HELPERS, loaded = new Set();
  pi.events.on("only-my-pi:mcp-task:v1", (payload) => { snapshot = payload.snapshot; if (payload.taskPinned) pendingSnapshot = payload.snapshot; });
  const save = () => { const copy = structuredClone(run); saved = saved.catch(() => {}).then(() => store.save(copy)); return saved; };
  const tools = () => closing || revoked ? [] : [...connections.values()].flatMap((entry) => entry.names).concat(connections.size ? helpers : []);
  controller.mcpDeclared = (name) => loaded.has(name) || ![...connections.values()].some((entry) => entry.server.tools.some((policy) => mcpToolName(entry.server.name, policy.name) === name && (policy.exposure ?? "direct") !== "direct"));
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
  const connect = async (server, files, credentials, readPaths, callId = null, signal, writeHandle) => {
    if (closing || revoked) throw mcpError("MCP_AUTHORIZATION_REVOKED");
    const remote = server.transport === "streamable-http";
    const record = { server: server.name, transport: server.transport, targetDigest: server.targetDigest, callId, kind: callId ? remote ? "remote" : writeHandle ? "write" : "read" : "discovery", pid: null, status: "starting" };
    const transport = remote ? new ControlledHttpTransport({ NativeTransport: NativeHttpTransport, server, ...credentials, record, save, signal,
      onUnauthorized: () => catalog.invalidateOAuth(server, snapshot.projectPath),
      authorize: async (expected) => {
        if (closing || revoked || !await catalog.current(server)) throw mcpError("MCP_AUTHORIZATION_REVOKED");
        if (digest((await catalog.credentials(server, snapshot.projectPath)).env) !== expected) throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED");
      } }) : new ControlledStdioTransport({ server, files, readPaths, writeHandle, configRoot, ...credentials, record, save });
    const client = new McpClient({ name: "only-my-pi", version: "1", requestTimeoutMs: MCP_LIMITS.timeoutMs });
    const connection = { client, transport, record, changed: false, failure: null };
    client.onError((error) => { connection.failure = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_CONNECTION_CLOSED"; });
    if (signal) {
      if (signal.aborted) throw mcpError("MCP_CALL_CANCELLED");
      const abort = () => { void client.close().catch(() => {}); void transport.close().catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true }); connection.disarm = () => signal.removeEventListener("abort", abort);
    }
    processes.add(connection); run.processes.push(record); await save();
    if (!remote) {
      transport.cwd = await fs.realpath(path.resolve(snapshot.projectPath, server.cwd ?? "."));
      if (transport.cwd !== snapshot.projectPath && !transport.cwd.startsWith(snapshot.projectPath + path.sep)) throw mcpError("MCP_CWD_NOT_ADMITTED");
    }
    client.onNotification("notifications/tools/list_changed", () => { connection.changed = true; grants.clear(); });
    client.onNotification("notifications/resources/list_changed", () => { connection.changed = true; grants.clear(); });
    try { await client.connect(transport); }
    catch (error) {
      connection.disarm?.();
      const closed = await Promise.allSettled([client.close(), transport.close()]);
      if (closed.some((outcome) => outcome.status === "rejected")) throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
      throw error;
    }
    // sandbox-exec legitimately changes comm during exec. The completed MCP
    // handshake pins the server lifetime after that transition.
    if (!remote) transport.record.identity = await processIdentity(transport.record.pid);
    await save();
    if (!callId) { connection.disarm?.(); if (remote) transport.signal = undefined; }
    return connection;
  };
  const call = async (server, policy, initial, toolCallId, params, signal, ctx) => {
    if (!mcpToolEnabled(policy)) return result("MCP_TOOL_HIDDEN");
    const entry = connections.get(server.name);
    const epoch = entry.epoch, definitionSignal = entry.definitionAbort.signal;
    const remote = server.transport === "streamable-http";
    if (typeof toolCallId !== "string" || !toolCallId || toolCallId.length > 256) return result("MCP_CALL_ID_INVALID");
    if (run.calls.some((call) => call.toolCallId === toolCallId)) return result("MCP_CALL_ALREADY_RECORDED");
    const record = { callId: randomUUID(), toolCallId, parentToolCallId: parents.get(toolCallId) ?? null, taskId: run.taskId, server: server.name, tool: policy.name, effect: policy.effect, targetDigest: server.targetDigest, revision: snapshot.revision, definitionDigest: digest(initial), inputDigest: digest(params), status: "checking", startedAt: new Date().toISOString() };
    if (run.calls.length >= MCP_LIMITS.calls || busy) return result("MCP_CALL_LIMIT");
    busy = true; run.calls.push(record); let execution, write, authority;
    try {
      if (Buffer.byteLength(JSON.stringify(params)) > MCP_LIMITS.inputBytes) throw mcpError("MCP_INPUT_LIMIT");
      await check(server);
      if (remote && containsSecret(params, entry.transport.secrets)) throw mcpError("MCP_SECRET_INPUT_REJECTED");
      if (remote && (await store.status(snapshot.projectPath)).runs.some((prior) => prior.calls.some((call) => call.targetDigest === server.targetDigest && call.effect === "remote" && call.status === "unknown"))) throw mcpError("MCP_REMOTE_RECONCILIATION_REQUIRED", 409);
      const current = (await entry.client.listTools({ signal, timeoutMs: MCP_LIMITS.timeoutMs })).find((tool) => tool.name === policy.name);
      if (entry.changed || entry.closed || !current || digest(current) !== record.definitionDigest) { invalidate(entry, "tool_definition_changed"); throw mcpError("MCP_TOOL_DEFINITION_CHANGED"); }
      if (!new Ajv({ strict: false }).compile(current.inputSchema)(params)) throw mcpError("MCP_ARGUMENTS_INVALID");
      if (policy.effect === "write") {
        if (controller.mcpWriteActive || controller.mutationCalls.size) throw mcpError("MCP_WRITE_IN_PROGRESS");
        controller.mcpWriteActive = true;
        authority = await controller.projectWriteAuthority(ctx);
        const prior = await store.status(snapshot.projectPath);
        if (prior.runs.some((item) => item.calls.some((call) => call.effect === "write" && call.status === "unknown"))) throw mcpError("MCP_WRITE_RECONCILIATION_REQUIRED", 409);
        write = await openWriteTarget({ project: snapshot.projectPath, value: params[policy.pathArgument], scopes: policy.paths, configRoot, files: entry.files, workspacePolicy: controller.workspacePolicy });
        record.target = write.target; record.beforeDigest = write.beforeDigest; record.fileIdentity = write.fileIdentity; record.projectOwnerIdentity = authority.ownerIdentity; record.application = "not_applied"; record.verification = "not_run";
      } else record.target = remote ? server.url : await selectedPath(snapshot.projectPath, params[policy.pathArgument], policy.paths);
      const key = digest([snapshot.projectPath, server.name, entry.credentialDigest, server.targetDigest, record.definitionDigest, record.target, write?.fileIdentity, snapshot.revision, ...(remote ? [record.inputDigest] : [])]);
      if (!grants.has(key)) {
        record.status = "awaiting_approval"; await save();
        if (!ctx.hasUI) throw mcpError("MCP_APPROVAL_REQUIRED");
        const title = `MCP · ${server.name}/${policy.name} · ${remote ? "远程操作" : write ? "写入" : "只读"}\n${record.target}\n配置版本 ${snapshot.revision} · ${remote ? `输入摘要 ${record.inputDigest}；可能产生外部效果，不授予本机项目写入\n操作参数：${JSON.stringify(params)}` : write ? "须同时持有编程授权与项目写入所有权，仅传递该文件描述符" : "仅允许声明路径"} · 10 秒 / 16 KiB 输入 / 64 KiB 输出`;
        // Keep the complete proposed scope within Pi/Host's bounded approval.
        // A digest or a truncated argument cannot substitute for review.
        if (remote && title.length > MCP_LIMITS.inputBytes) throw mcpError("MCP_INPUT_LIMIT");
        const choice = await ctx.ui.select(title, ["拒绝", "仅本次", "本任务"]);
        if (!["仅本次", "本任务"].includes(choice)) throw mcpError("MCP_CALL_DENIED");
        await check(server);
        if (signal?.aborted) throw mcpError("MCP_CALL_CANCELLED");
        if (entry.changed || entry.closed || entry.epoch !== epoch) throw mcpError("MCP_TOOL_DEFINITION_CHANGED");
        if (choice === "本任务") grants.add(key);
        record.authorization = choice === "本任务" ? "task" : "once";
      } else record.authorization = "task";
      if (!remote && digest(await launchIdentity(server)) !== digest(entry.files)) throw mcpError("MCP_CODE_IDENTITY_CHANGED");
      if (write) { await authority.assert(); await write.assert(); }
      else if (!remote && await selectedPath(snapshot.projectPath, params[policy.pathArgument], policy.paths) !== record.target) throw mcpError("MCP_TARGET_CHANGED");
      if (entry.changed || entry.closed || entry.epoch !== epoch) throw mcpError("MCP_TOOL_DEFINITION_CHANGED");
      const timeout = AbortSignal.timeout(MCP_LIMITS.timeoutMs), callSignal = AbortSignal.any([signal, timeout, authority?.signal, definitionSignal].filter(Boolean));
      // An approved writer can mutate its descriptor during startup. Record the
      // attempted effect boundary before launch, even before tools/call exists.
      if (write) { record.status = "dispatched"; record.application = "unknown"; await save(); await authority.assert(); await write.assert(); }
      execution = await connect(server, entry.files, await catalog.credentials(server, snapshot.projectPath), write ? [] : [record.target], record.callId, callSignal, write?.handle);
      const fresh = (await execution.client.listTools({ signal: callSignal, timeoutMs: MCP_LIMITS.timeoutMs })).find((tool) => tool.name === policy.name);
      if (!fresh || digest(fresh) !== record.definitionDigest || execution.changed || entry.changed || entry.epoch !== epoch) throw mcpError("MCP_TOOL_DEFINITION_CHANGED");
      execution.transport.beforeToolCall = async () => {
        await check(server);
        if (write) { await authority.assert(); await write.assert(); }
        else if (!remote && await selectedPath(snapshot.projectPath, params[policy.pathArgument], policy.paths) !== record.target) throw mcpError("MCP_TARGET_CHANGED");
        if (callSignal.aborted || execution.changed || entry.closed || entry.changed || entry.epoch !== epoch) throw mcpError("MCP_AUTHORIZATION_REVOKED");
      };
      if (remote) execution.transport.beforeDispatch = async () => { record.status = "dispatched"; await save(); };
      else { record.status = "dispatched"; await save(); }
      await check(server);
      const output = await execution.client.callTool(policy.name, remote ? params : { ...params, [policy.pathArgument]: write ? "/dev/fd/3" : record.target }, { signal: callSignal, timeoutMs: MCP_LIMITS.timeoutMs });
      if (Buffer.byteLength(JSON.stringify(output)) > MCP_LIMITS.outputBytes || !Array.isArray(output.content) || output.content.some((block) => block.type !== "text" || typeof block.text !== "string")) throw mcpError("MCP_RESULT_NOT_ADMITTED");
      await execution.client.close(); await execution.transport.close();
      if (write) await write.verifyIdentity();
      record.status = output.isError ? "failed" : "completed"; record.completedAt = new Date().toISOString();
      if (write) { record.afterDigest = await write.digest(); record.observedChange = record.afterDigest !== record.beforeDigest; record.application = record.observedChange ? "applied" : "not_applied"; }
      await save();
      return { ...(output.isError ? { isError: true } : {}), content: output.content, details: { callId: record.callId, status: record.status, revision: record.revision, server: server.name, tool: policy.name, ...(write ? { application: record.application, verification: "not_run", beforeDigest: record.beforeDigest, afterDigest: record.afterDigest } : {}) } };
    } catch (error) {
      record.code = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_CALL_FAILED";
      record.status = record.status === "dispatched" && (!remote || execution?.transport.businessAttempted) ? "unknown" : "rejected";
      if (write) { record.application = record.status === "unknown" ? "unknown" : "not_applied"; }
      await save();
      return { ...result(`${record.code}${record.status === "unknown" ? ": 结果未知，不自动重试" : ""}`), details: { status: record.status, code: record.code, ...(write ? { application: record.application, verification: "not_run" } : {}) } };
    } finally {
      if (execution) { execution.disarm?.(); await execution.client.close().catch(() => {}); await execution.transport.close().catch(() => {}); }
      try {
        if (write) { record.afterDigest ??= await write.digest().catch(() => null); record.observedChange = record.afterDigest !== null && record.afterDigest !== record.beforeDigest; await write.handle.close(); await save(); }
      } finally {
        const unresolved = write && [...processes].some((entry) => entry.record.kind === "write" && entry.record.status !== "stopped");
        if (policy.effect === "write") controller.mcpWriteActive = Boolean(unresolved);
        busy = Boolean(unresolved);
      }
    }
  };
  const register = (entry, available = []) => {
    entry.names = [];
    for (const policy of entry.server.tools) {
      const tool = available.find((item) => item.name === policy.name), name = mcpToolName(entry.server.name, policy.name);
      const enabled = Boolean(tool && mcpToolEnabled(policy) && !entry.changed && !entry.closed);
      if (enabled) entry.names.push(name);
      pi.registerTool({ name, label: `${entry.server.name}/${policy.name}`, description: `OMP 受控 ${policy.effect} 工具；逐调用授权，写入还须 Coding、项目所有权和物理限制。${tool?.description ?? "工具已撤回或不可用"}`, parameters: tool?.inputSchema ?? entry.available?.find((item) => item.name === policy.name)?.inputSchema ?? { type: "object" }, executionMode: "sequential", exposure: enabled ? policy.exposure ?? "direct" : "hidden",
        execute: (id, params, signal, _update, ctx) => tool ? call(entry.server, policy, tool, id, params, signal, ctx) : result("MCP_TOOL_WITHDRAWN") });
    }
    controller.applyToolCeiling();
  };
  const invalidate = (entry, type) => {
    entry.definitionAbort.abort(); entry.definitionAbort = new AbortController();
    entry.epoch++; entry.changed = true; grants.clear(); for (const name of entry.names) loaded.delete(name);
    if (entry.metadata) {
      entry.metadata.status = type === "disconnected" ? "disconnected" : "stale"; entry.metadata.epoch = entry.epoch;
      entry.metadata.tools = entry.metadata.tools.map((tool) => ({ ...tool, active: false }));
      entry.metadata.events.push({ type, at: new Date().toISOString() }); entry.metadata.events = entry.metadata.events.slice(-64);
    }
    register(entry); void save().catch(() => {});
  };
  const watch = (entry) => {
    const client = entry.client;
    const disconnected = (error) => {
      if (closing || connections.get(entry.server.name) !== entry || client !== entry.client || entry.closed) return;
      entry.closed = true; entry.metadata.code = /^[A-Z_]+$/u.test(error?.code ?? "") ? error.code : "MCP_CONNECTION_CLOSED";
      invalidate(entry, "disconnected");
      void Promise.allSettled([client.close(), entry.transport.close()]);
    };
    for (const type of ["notifications/tools/list_changed", "notifications/resources/list_changed"]) client.onNotification(type, () => {
      if (closing || connections.get(entry.server.name) !== entry || client !== entry.client) return;
      invalidate(entry, type); void refresh(entry).catch(() => {});
    });
    client.onError(disconnected); client.onClose(() => disconnected());
    if (entry.failure) disconnected(mcpError(entry.failure));
  };
  const refresh = (entry, explicit = false, signal) => {
    if (entry.refreshing) return entry.refreshing;
    entry.refreshing = (async () => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(MCP_LIMITS.timeoutMs)].filter(Boolean));
      if (++discoveryAttempts > MCP_LIMITS.discoveries) throw mcpError("MCP_DISCOVERY_LIMIT");
      await check(entry.server);
      if (entry.closed) {
        if (!explicit) throw mcpError("MCP_CONNECTION_CLOSED");
        const old = entry.client, replacement = await connect(entry.server, entry.files, await catalog.credentials(entry.server, snapshot.projectPath), [], null, deadline);
        Object.assign(entry, replacement, { closed: false }); watch(entry); await old.close();
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (entry.closed) throw mcpError("MCP_CONNECTION_CLOSED");
        const epoch = entry.epoch; entry.metadata.status = "discovering"; await save();
        const actual = await discoverClient(entry.client, entry.server, deadline); await check(entry.server);
        if (epoch !== entry.epoch) continue;
        const identity = digest(actual);
        if (entry.definitionDigest && entry.definitionDigest !== identity) invalidate(entry, "rediscovered_definition_changed");
        entry.definitionDigest = identity; entry.available = actual.tools; entry.resources = actual.resources; entry.changed = false;
        entry.metadata.status = "ready"; entry.metadata.epoch = entry.epoch; entry.metadata.discoveredAt = new Date().toISOString();
        delete entry.metadata.code;
        entry.metadata.tools = entry.server.tools.map((policy) => ({ name: policy.name, exposure: policy.active === false ? "hidden" : policy.exposure ?? "direct", active: mcpToolEnabled(policy) && actual.tools.some((tool) => tool.name === policy.name), definitionDigest: actual.tools.some((tool) => tool.name === policy.name) ? digest(actual.tools.find((tool) => tool.name === policy.name)) : null }));
        entry.metadata.resources = admittedResources(entry.server, actual.resources);
        register(entry, actual.tools); await save(); return entry.metadata;
      }
      throw mcpError("MCP_DISCOVERY_RACE");
    })().catch(async (error) => {
      entry.changed = true; grants.clear(); register(entry); entry.metadata.tools = entry.metadata.tools.map((tool) => ({ ...tool, active: false })); entry.metadata.status = entry.closed ? "disconnected" : "failed"; entry.metadata.code = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_DISCOVERY_FAILED"; await save(); throw error;
    }).finally(() => { entry.refreshing = undefined; });
    return entry.refreshing;
  };
  const readResource = async (id, params, signal, ctx) => {
    let entry, policy;
    try { resourceUri(params.uri, params.server); entry = connections.get(params.server); policy = entry?.server.resources?.find((item) => item.active !== false && item.uri === params.uri); if (!policy) throw mcpError("MCP_RESOURCE_NOT_ADMITTED"); }
    catch { return result("MCP_RESOURCE_NOT_ADMITTED"); }
    if (busy || run.calls.length >= MCP_LIMITS.calls) return result("MCP_CALL_LIMIT");
    const epoch = entry.epoch, definitionSignal = entry.definitionAbort.signal, initial = entry.resources?.find((item) => item.uri === params.uri);
    const record = { callId: randomUUID(), toolCallId: id, parentToolCallId: parents.get(id) ?? null, taskId: run.taskId, server: params.server, tool: "resources/read", effect: "read", kind: "resource", uri: params.uri, target: params.uri, targetDigest: entry.server.targetDigest, revision: snapshot.revision, status: "checking", startedAt: new Date().toISOString(), definitionDigest: initial ? digest(initial) : null };
    busy = true; run.calls.push(record); let execution;
    try {
      await check(entry.server);
      if ((await store.status(snapshot.projectPath)).runs.some((prior) => prior.calls.some((call) => call.kind === "resource" && call.targetDigest === entry.server.targetDigest && call.uri === params.uri && call.status === "unknown"))) throw mcpError("MCP_RESOURCE_RECONCILIATION_REQUIRED", 409);
      if (entry.changed || entry.closed || !initial) throw mcpError("MCP_RESOURCE_DEFINITION_CHANGED");
      if (!policy.mimeTypes.includes(initial.mimeType ?? "application/octet-stream") || initial.size !== undefined && (!Number.isSafeInteger(initial.size) || initial.size < 0 || initial.size > MCP_LIMITS.outputBytes)) throw mcpError("MCP_RESOURCE_TYPE_NOT_ADMITTED");
      const key = digest([snapshot.projectPath, entry.server.targetDigest, entry.credentialDigest, record.definitionDigest, params.uri, snapshot.revision, epoch]);
      if (!grants.has(key)) {
        record.status = "awaiting_approval"; await save(); if (!ctx.hasUI) throw mcpError("MCP_APPROVAL_REQUIRED");
        const title = `MCP · ${params.server}/资源读取\n${params.uri}\n服务目标 ${entry.server.transport === "streamable-http" ? entry.server.url : entry.server.command}\n类型 ${initial.mimeType ?? "application/octet-stream"} · 配置版本 ${snapshot.revision} · 定义 ${record.definitionDigest}\n${entry.server.transport === "stdio" ? `服务只可读取声明文件：${(policy.paths ?? []).join("、") || "无"}；` : ""}仅返回有来源的数据；10 秒 / 64 KiB；不执行 HTML/MCP Apps`;
        if (Buffer.byteLength(title) > MCP_LIMITS.inputBytes) throw mcpError("MCP_INPUT_LIMIT");
        const choice = await ctx.ui.select(title, ["拒绝", "仅本次", "本任务"]);
        if (!["仅本次", "本任务"].includes(choice)) throw mcpError("MCP_CALL_DENIED");
        if (choice === "本任务") grants.add(key); record.authorization = choice === "本任务" ? "task" : "once";
      } else record.authorization = "task";
      await check(entry.server); if (signal?.aborted || entry.changed || entry.closed || epoch !== entry.epoch) throw mcpError("MCP_RESOURCE_DEFINITION_CHANGED");
      if (entry.server.transport === "stdio" && digest(await launchIdentity(entry.server)) !== digest(entry.files)) throw mcpError("MCP_CODE_IDENTITY_CHANGED");
      const readPaths = await Promise.all((policy.paths ?? []).map((value) => selectedPath(snapshot.projectPath, value, policy.paths)));
      const callSignal = AbortSignal.any([signal, definitionSignal, AbortSignal.timeout(MCP_LIMITS.timeoutMs)].filter(Boolean));
      execution = await connect(entry.server, entry.files, await catalog.credentials(entry.server, snapshot.projectPath), readPaths, record.callId, callSignal);
      const actual = await discoverClient(execution.client, entry.server, callSignal), fresh = actual.resources.find((item) => item.uri === params.uri);
      if (!fresh || digest(fresh) !== record.definitionDigest || execution.changed || entry.changed || epoch !== entry.epoch) throw mcpError("MCP_RESOURCE_DEFINITION_CHANGED");
      execution.transport.beforeToolCall = async () => { await check(entry.server); if (callSignal.aborted || entry.changed || execution.changed || epoch !== entry.epoch) throw mcpError("MCP_RESOURCE_DEFINITION_CHANGED"); };
      execution.transport.beforeDispatch = async () => { record.status = "dispatched"; await save(); };
      if (entry.server.transport === "stdio") { await execution.transport.beforeToolCall(); record.status = "dispatched"; await save(); }
      const output = await execution.client.readResource(params.uri, { signal: callSignal, timeoutMs: MCP_LIMITS.timeoutMs });
      const parsed = resourceContent(output, policy, initial, execution.transport.secrets);
      if (containsSecret(parsed.content, execution.transport.secrets)) throw mcpError("MCP_SECRET_OUTPUT_REJECTED");
      await execution.client.close(); await execution.transport.close();
      record.status = parsed.isError ? "failed" : "completed"; if (parsed.details?.code) record.code = parsed.details.code; record.partial = parsed.details?.partial ?? false; record.completedAt = new Date().toISOString(); await save();
      return { ...parsed, content: [{ type: "text", text: `来源 MCP ${params.server} · ${params.uri} · 定义 ${record.definitionDigest}` }, ...parsed.content], details: { ...parsed.details, status: record.status, server: params.server, uri: params.uri, callId: record.callId, ownerTaskId: run.taskId, definitionDigest: record.definitionDigest } };
    } catch (error) {
      record.code = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_RESOURCE_FAILED"; record.status = record.status === "dispatched" ? "unknown" : "rejected"; await save();
      return { ...result(`${record.code}${record.status === "unknown" ? ": 结果未知，不自动重试" : ""}`), details: { status: record.status, code: record.code, server: params.server, uri: params.uri, ownerTaskId: run.taskId } };
    } finally { execution?.disarm?.(); if (execution) { await execution.client.close().catch(() => {}); await execution.transport.close().catch(() => {}); } busy = false; }
  };
  const installHelpers = async () => {
    if (helpersInstalled) return; helpersInstalled = true;
    const sdk = await import(pathToFileURL(process.env.OMP_MCP_SDK_FILE).href);
    sdk.createToolSearchExtension()(new Proxy(pi, { get(target, key) {
      if (key === "getAllTools") return () => pi.getAllTools().filter((tool) => tools().includes(tool.name));
      if (key === "registerTool") return (native) => pi.registerTool({ ...native, name: "mcp_tool_search", defaultActive: true, description: native.description.replaceAll("tool_search", "mcp_tool_search"), async execute(id, input, signal, update, ctx) {
        try { for (const entry of connections.values()) await refresh(entry, true, signal); const output = await native.execute(id, input, signal, update, ctx); for (const name of output.details?.loaded ?? []) if (tools().includes(name)) loaded.add(name); controller.applyToolCeiling(); return output; }
        catch (error) { return result(error.code ?? "MCP_DISCOVERY_FAILED"); }
      } });
      return target[key];
    } }));
    const parameters = { type: "object", additionalProperties: false, properties: { server: { type: "string" } }, required: ["server"] };
    pi.registerTool({ name: "mcp_list_resources", label: "MCP 资源发现", description: "重新发现当前已准入服务器的允许资源；不启用服务器或授予读取许可。", parameters, execute: async (_id, { server }, signal) => {
      try { const entry = connections.get(server); if (!entry) throw mcpError("MCP_SERVER_NOT_ADMITTED"); const metadata = await refresh(entry, true, signal); return { content: [{ type: "text", text: JSON.stringify({ server, targetDigest: entry.server.targetDigest, epoch: metadata.epoch, resources: metadata.resources }) }] }; }
      catch (error) { return result(error.code ?? "MCP_DISCOVERY_FAILED"); }
    } });
    pi.registerTool({ name: "mcp_read_resource", label: "MCP 资源读取", description: "逐调用授权读取精确准入 URI；验证来源、类型、大小，仅返回数据，不执行 HTML/MCP Apps 或授予本机文件访问。", parameters: { ...parameters, properties: { ...parameters.properties, uri: { type: "string", maxLength: 2048 } }, required: ["server", "uri"] }, executionMode: "sequential", execute: (id, input, signal, _update, ctx) => readResource(id, input, signal, ctx) });
  };
  const startTask = async (ctx) => {
    const projectPath = await fs.realpath(ctx.cwd);
    if (tui) {
      if (!cleanupConfirmed) throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
      snapshot = pendingSnapshot ?? await catalog.snapshot(projectPath); pendingSnapshot = undefined; connections.clear(); processes.clear(); parents.clear(); run = undefined;
      revoked = false; closing = false; generation++; discoveryAttempts = 0; loaded.clear();
    } else snapshot ??= await catalog.snapshot(projectPath);
    if (snapshot.projectPath !== projectPath) throw mcpError("MCP_PROJECT_BINDING_CHANGED");
    controller.mcpTools = tools; controller.applyToolCeiling();
    const selected = snapshot.servers.filter((server) => server.enabled);
    if (!selected.length) return;
    run = await store.begin({ taskId: process.env.OMP_HOST_INPUT_TASK_ID ?? `cli_${randomUUID()}`, projectPath, revision: snapshot.revision });
    run.discoveries = [];
    cleanupConfirmed = false;
    try {
    ({ McpClient, StreamableHttpTransport: NativeHttpTransport } = await loadNativeMcp(process.env.OMP_MCP_SDK_FILE));
    for (const server of selected) {
      const files = server.transport === "streamable-http" ? [] : await launchIdentity(server), credentials = await catalog.credentials(server, projectPath);
      const discovery = await connect(server, files, credentials, []);
      const metadata = { server: server.name, targetDigest: server.targetDigest, status: "discovering", epoch: 0, tools: [], resources: [], events: [] };
      const entry = { ...discovery, server, files, credentialDigest: digest(credentials.env), names: [], epoch: 0, definitionAbort: new AbortController(), closed: false, metadata }; connections.set(server.name, entry); run.discoveries.push(metadata);
      watch(entry); await refresh(entry);
    }
    await installHelpers();
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
    if (!event.toolName.startsWith("mcp__") && !helpers.includes(event.toolName)) return;
    if (!tools().includes(event.toolName)) return { block: true, reason: "MCP_SERVER_NOT_ADMITTED" };
    if (event.parentToolCallId && (typeof event.parentToolCallId !== "string" || event.parentToolCallId.length > 256)) return { block: true, reason: "MCP_CALL_ID_INVALID" };
    parents.set(event.toolCallId, event.parentToolCallId ?? null);
  });
  pi.on("agent_end", () => grants.clear());
  // Pi may continue a queued input after a low-level agent_end without another
  // before_agent_start. Keep the same snapshot/budget until the public logical
  // run settles; Pi defers new prompts while agent_settled handlers clean up.
  pi.on("agent_settled", async () => { if (tui) await stop(); });
  pi.on("session_shutdown", stop);
  const receive = async (message) => {
    if (message?.type === "mcp_discover" && typeof message.id === "string") {
      try { const entry = connections.get(message.name); if (!entry) throw mcpError("MCP_SERVER_NOT_ADMITTED"); await refresh(entry, true); if (process.connected) process.send({ type: "mcp_discovered", id: message.id, clean: true }, () => {}); }
      catch (error) { if (process.connected) process.send({ type: "mcp_discovered", id: message.id, clean: false, code: error.code ?? "MCP_DISCOVERY_FAILED" }, () => {}); }
      return;
    }
    if (!["mcp_revoke", "mcp_prepare_shutdown"].includes(message?.type) || typeof message.id !== "string") return;
    revoked = true; await stop().catch(() => {});
    if (process.connected) process.send({ type: "mcp_stopped", id: message.id, clean: !run || cleanupConfirmed }, () => {});
  };
  process.on("message", receive);
  pi.on("session_shutdown", () => process.off("message", receive));
  return { tools, stop, clean: () => !run || cleanupConfirmed };
}
