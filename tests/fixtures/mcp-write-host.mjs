import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMcpHost, providerReply, until } from "./mcp-host.mjs";
export const codingRequest = { taskSummary: "Write selected MCP fixture file", complexity: "simple", scope: ["README.md"], riskFlags: [], verification: ["inspect actual file bytes"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
export const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
export async function createWriteHost({ mode, target = "README.md", coding = true, repeat = false, ...options } = {}) {
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => {
    const calls = body.messages.filter((message) => message.role === "tool").length;
    const ask = coding && calls === 0;
    providerReply(res, ask ? "request_coding_access" : calls < (coding ? 2 : 1) || (repeat && calls === 2) ? "mcp__local__write_file" : null, ask ? codingRequest : { path: target, text: "approved MCP file bytes\n" });
  }, ...options });
  for (const args of [["init", "--quiet"], ["add", "README.md"], ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]]) await promisify(execFile)("git", args, { cwd: f.project });
  const service = fileURLToPath(new URL("./mcp-write-server.mjs", import.meta.url));
  f.server = { ...f.server, args: [service], codePaths: [service], env: mode ? { F_MODE: mode } : {}, tools: [{ name: "write_file", effect: "write", writeMode: "descriptor", pathArgument: "path", paths: ["README.md"] }] };
  try { await f.mcp({ type: "save", revision: 0, server: { ...f.server, enabled: true } }); }
  catch (error) { await f.close(); throw error; }
  return f;
}
export async function codingApproved(f, started) {
  // HTTP acceptance precedes Pi readiness. Keep the approval poll separate
  // from the worker's existing 30s initialization contract.
  await until(() => f.task(started.taskId), task => task.status !== "starting", "Pi task initialized", 30000);
  const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0 || terminal(task), "coding approval");
  if (!waiting.approvals.length) throw new Error(JSON.stringify(waiting));
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: waiting.approvals[0].options[0] });
  return until(() => f.task(started.taskId), (task) => task.approvals.some((entry) => entry.title.startsWith("MCP ·")) || terminal(task), "MCP write approval");
}
export const approveWrite = (f, waiting, value = "仅本次") => f.request("/api/command", { type: "answerApproval", taskId: waiting.taskId, approvalId: waiting.approvals[0].approvalId, value });
