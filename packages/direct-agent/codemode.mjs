import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { createClassificationControl } from "../model-calls/runtime.mjs";
import { registerClassifierCommand } from "../model-calls/commands.mjs";
import { digest } from "../mcp/catalog.mjs";

export const CODEMODE_LIMITS = Object.freeze({ timeoutMs: 60000, inputBytes: 32768, argumentBytes: 16384, outputBytes: 65536, concurrency: 4, calls: 32, scripts: 16, memoryBytes: 268435456, storeBytes: 1048576, historyBytes: 8388608, temporaryBytes: 67108864, nativeOutputCharacters: 16777216, nativeOutputItems: 100000 });
const failure = (code, result) => {
  const partial = (result?.content ?? []).filter((block) => block.type === "text").slice(1).map((block) => block.text).join("\n")
    .replace(/\n\n\[Full output: [^\n]+\]/u, "").replace(/\[Image saved to [^\n]+\]/gu, "[Image output omitted]");
  const excerpt = Buffer.from(partial).subarray(0, CODEMODE_LIMITS.outputBytes - 2048).toString("utf8");
  return { isError: true, content: [{ type: "text", text: `${code}${excerpt ? `\nPartial output:\n${excerpt}` : ""}` }], details: { calls: result?.details?.calls ?? [], status: "failed", code, limits: CODEMODE_LIMITS } };
};
const fail = (code) => Object.assign(new Error(code), { code });
const bytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "");
// Mirror the pinned native entry format only to measure its effective state.
// Pi remains responsible for restoring and executing the store itself.
function applyStore(store, data) {
  if (typeof data?.set !== "object" || data.set === null || !Array.isArray(data.delete) || !data.delete.every((key) => typeof key === "string")) return;
  for (const key of data.delete) store.delete(key);
  for (const [key, value] of Object.entries(data.set)) store.set(key, value);
}
async function ordinaryTarget(ctx, input) {
  if (typeof input.path !== "string") return { path: ctx.cwd, identity: digest([ctx.cwd, input]) };
  const proposed = path.resolve(ctx.cwd, input.path);
  try {
    const canonical = await fs.realpath(proposed), stat = await fs.stat(canonical);
    return { path: canonical, identity: digest([canonical, stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs]) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { path: proposed, identity: digest([proposed, "missing"]) };
  }
}

// The public Pi extension owns the actual QuickJS execution and branch store.
// OMP wraps its execution boundary; it never restores grants from that store.
/** @param {any} pi @param {any} [options] */
export async function installOmpCodemode(pi, { controller, sdkFile = process.env.OMP_MCP_SDK_FILE } = {}) {
  if (!path.isAbsolute(sdkFile ?? "")) return { enabled: false };
  const manifest = JSON.parse(await fs.readFile(path.resolve(path.dirname(sdkFile), "../package.json"), "utf8"));
  if (manifest.version !== "1.1.0") return { enabled: false }; // Historical controlled stacks retain their contract.
  if (manifest.name !== "@earendil-works/pi-coding-agent") throw fail("CODEMODE_RUNTIME_BINDING_INVALID");
  const sdk = await import(pathToFileURL(sdkFile).href);
  const codemodeManifest = findPackageJSON("@earendil-works/pi-codemode", pathToFileURL(sdkFile));
  const metadata = JSON.parse(await fs.readFile(codemodeManifest, "utf8"));
  if (metadata.version !== "1.1.0") throw fail("CODEMODE_RUNTIME_VERSION_MISMATCH");
  const { parseCodemodeSource } = await import(pathToFileURL(path.resolve(path.dirname(codemodeManifest), metadata.exports["."].import)).href);
  const classification = createClassificationControl(pi, { sdkFile, configRoot: process.env.PI_CODING_AGENT_DIR });
  registerClassifierCommand(pi, { sdkFile, configRoot: process.env.PI_CODING_AGENT_DIR });
  registerClassifierCommand(pi, { sdkFile, configRoot: process.env.PI_CODING_AGENT_DIR, kind: "image" });
  const grants = new Set(), running = new Map();
  let revoked = false, scripts = 0, totalCalls = 0, active;
  controller.codemodeTools = () => revoked ? [] : ["codemode"];
  pi.events.emit("only-my-pi:owned-codemode:v1", { admits: (name, parent) => !revoked && (name === "codemode" || running.has(parent)) });
  const check = (run) => {
    if (revoked || run.signal.aborted || running.get(run.id) !== run) throw fail("CODEMODE_CANCELLED");
  };
  const proxy = new Proxy(pi, { get(target, key) {
    if (key === "appendEntry") return (type, data) => {
      if (type === "codemode-store") {
        check(active);
        const store = new Map(active.store); applyStore(store, data);
        if (bytes(Object.fromEntries(store)) > CODEMODE_LIMITS.storeBytes || active.historyBytes + bytes(data) > CODEMODE_LIMITS.historyBytes) throw fail("CODEMODE_STORAGE_LIMIT");
        active.store = store; active.historyBytes += bytes(data);
      }
      if (type === "codemode-store") { active.entries.push([type, data]); return; }
      return pi.appendEntry(type, data);
    };
    if (key !== "registerTool") return target[key];
    return (native) => pi.registerTool({ ...native, defaultActive: true, executionMode: "sequential",
      async execute(id, input, signal, onUpdate, ctx) {
        if (revoked || running.size || ++scripts > CODEMODE_LIMITS.scripts) return failure("CODEMODE_EXECUTION_LIMIT");
        if (typeof input.code !== "string" || bytes(input) > CODEMODE_LIMITS.inputBytes) return failure("CODEMODE_INPUT_LIMIT");
        let parsed; try { parsed = parseCodemodeSource(input.code); } catch { return failure("CODEMODE_SOURCE_INVALID"); }
        const entries = ctx.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === "codemode-store");
        const historyBytes = entries.reduce((sum, entry) => sum + bytes(entry.data), 0), store = new Map();
        if (historyBytes > CODEMODE_LIMITS.historyBytes) return failure("CODEMODE_STORAGE_LIMIT");
        for (const entry of entries) applyStore(store, entry.data);
        if (bytes(Object.fromEntries(store)) > CODEMODE_LIMITS.storeBytes) return failure("CODEMODE_STORAGE_LIMIT");
        const timeoutMs = Math.min(parsed.options.timeoutMs ?? CODEMODE_LIMITS.timeoutMs, CODEMODE_LIMITS.timeoutMs);
        const abort = new AbortController(), deadline = AbortSignal.timeout(timeoutMs);
        const run = { id, ctx, abort, signal: AbortSignal.any([signal, abort.signal, deadline].filter(Boolean)), pending: 0, entries: [], store, historyBytes };
        running.set(id, run); active = run;
        const originalTmp = process.env.TMPDIR;
        let temporary;
        const allowed = () => new Set(controller.activeToolCeiling());
        const guardedContext = { ...ctx, tools: ctx.tools.filter((tool) => allowed().has(tool.name)),
          async executeTool(name, args, options) {
            check(run);
            if (!allowed().has(name) || !ctx.tools.some((tool) => tool.name === name)) throw fail("CODEMODE_TOOL_NOT_ADMITTED");
            if (bytes(args) > CODEMODE_LIMITS.argumentBytes) throw fail("CODEMODE_ARGUMENT_LIMIT");
            if (++totalCalls > CODEMODE_LIMITS.calls || run.pending >= CODEMODE_LIMITS.concurrency) throw fail("CODEMODE_CALL_LIMIT");
            run.pending++;
            try {
              const outcome = await ctx.executeTool(name, args, { ...options, signal: AbortSignal.any([run.signal, options?.signal].filter(Boolean)) });
              if (bytes(outcome.result) > CODEMODE_LIMITS.outputBytes) throw fail("CODEMODE_RESULT_LIMIT");
              return outcome;
            } finally { run.pending--; }
          },
        };
        try {
          // Pi's public executor spills bounded output into os.tmpdir(). Give
          // this sequential script an owned directory, including image files,
          // and remove it after completion rather than restoring file access.
          temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-codemode-"));
          process.env.TMPDIR = temporary;
          const bounded = { code: `// @options: ${JSON.stringify({ timeout_ms: timeoutMs, max_output_tokens: Math.min(parsed.options.maxOutputTokens ?? 16000, 16000) })}\n${parsed.code}` };
          guardedContext.modelRegistry = await classification.registry(ctx, id, run.signal, () => check(run));
          const result = await native.execute(id, bounded, run.signal, onUpdate, guardedContext);
          if (deadline.aborted) return failure("CODEMODE_TIMEOUT", result);
          if (run.signal.aborted) return failure("CODEMODE_CANCELLED", result);
          // Native token truncation may create one private temporary text file.
          // It is not exposed as an arbitrary read capability or retained state.
          if (result.details?.fullOutputPath) {
            const file = result.details.fullOutputPath;
            if (path.dirname(file) !== temporary || !/^pi-codemode-[a-f0-9]{16}\.txt$/u.test(path.basename(file))) throw fail("CODEMODE_OUTPUT_PATH_INVALID");
            delete result.details.fullOutputPath;
            return failure("CODEMODE_OUTPUT_LIMIT", result);
          }
          const content = await classification.output(result.content);
          if (bytes(content.filter(block => block.type === "text")) > CODEMODE_LIMITS.outputBytes) return failure("CODEMODE_OUTPUT_LIMIT", result);
          result.content = content;
          delete result.details?.imagePaths;
          if (!result.isError) { check(run); for (const [type, data] of run.entries) pi.appendEntry(type, data); }
          return { ...result, details: { ...result.details, limits: CODEMODE_LIMITS, models: { classifier: "requires_project_binding_and_task_permission", image: "requires_project_binding_and_task_permission" } } };
        } catch (error) { return failure(/^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "CODEMODE_EXECUTION_FAILED"); }
        finally {
          abort.abort(); running.delete(id); active = undefined;
          if (originalTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = originalTmp;
          if (temporary) await fs.rm(temporary, { recursive: true, force: true });
        }
      },
    });
  } });
  sdk.createCodemodeExtension({ mode: "on", models: true })(proxy);
  pi.on("tool_call", async (event, ctx) => {
    const run = running.get(event.parentToolCallId);
    if (!run) return;
    try {
      check(run);
      if (controller.mcpTools?.().includes(event.toolName)) return; // MCP performs its own scope/definition/target authorization.
      if (!controller.activeToolCeiling().includes(event.toolName)) throw fail("CODEMODE_TOOL_NOT_ADMITTED");
      const definition = pi.getAllTools().find((tool) => tool.name === event.toolName);
      const target = await ordinaryTarget(ctx, event.input);
      const key = digest([ctx.sessionManager.getSessionId(), ctx.cwd, event.toolName, definition, event.input, target.identity]);
      if (!grants.has(key)) {
        if (!ctx.hasUI) throw fail("CODEMODE_APPROVAL_REQUIRED");
        const choice = await ctx.ui.select(`Codemode · ${event.toolName}\n项目 ${ctx.cwd}\n目标 ${target.path}\n父调用 ${event.parentToolCallId} · 子调用 ${event.toolCallId}\n参数 ${JSON.stringify(event.input)}\n父脚本不授予子调用许可；最长 ${CODEMODE_LIMITS.timeoutMs / 1000} 秒`, ["拒绝", "仅本次", "本任务"]);
        check(run);
        if (!["仅本次", "本任务"].includes(choice)) throw fail("CODEMODE_CALL_DENIED");
        if (digest(pi.getAllTools().find((tool) => tool.name === event.toolName)) !== digest(definition) || !controller.activeToolCeiling().includes(event.toolName)) throw fail("CODEMODE_TOOL_DEFINITION_CHANGED");
        if ((await ordinaryTarget(ctx, event.input)).identity !== target.identity) throw fail("CODEMODE_TARGET_CHANGED");
        if (choice === "本任务") grants.add(key);
      }
    } catch (error) { return { block: true, reason: error.code ?? "CODEMODE_CALL_DENIED" }; }
  });
  const revoke = () => { revoked = true; grants.clear(); for (const run of running.values()) run.abort.abort(); };
  const receive = (message) => {
    if (!["revoke", "prepare_shutdown", "mcp_revoke", "codemode_revoke"].includes(message?.type)) return;
    revoke();
    if (message.type === "codemode_revoke" && process.connected) process.send({ type: "codemode_revoked", id: message.id }, () => {});
  };
  process.on("message", receive);
  pi.on("before_agent_start", (_event, ctx) => { grants.clear(); if (ctx.mode === "tui") { revoked = false; scripts = 0; totalCalls = 0; } });
  pi.on("agent_end", () => grants.clear());
  pi.on("session_shutdown", () => { revoke(); process.off("message", receive); });
  return { enabled: true };
}
