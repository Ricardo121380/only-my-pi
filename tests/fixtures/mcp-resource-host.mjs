import { createMcpHost, providerReply, until } from "./mcp-host.mjs";
import { createHttpMcpServer } from "./mcp-http-server.mjs";
export const ended = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
export async function finishResources(f, started, value = "仅本次") {
  for (;;) {
    const task = await until(() => f.task(started.taskId), (item) => item.approvals.length || ended(item), "resource journey", 25000);
    if (ended(task)) return task;
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: task.approvals[0].approvalId, value });
  }
}
export async function createResourceHost({ respond, assetsRoot, installedExtensions = true } = {}) {
  const service = await createHttpMcpServer({ discovery: true });
  let f;
  try {
    f = await createMcpHost({ assetsRoot, installedExtensions, respond: respond ?? (({ body, res }) => providerReply(res, body.messages.some((item) => item.role === "tool") ? null : "mcp_read_resource", { server: "remote", uri: "mcp://remote/readme" })) });
    const server = { name: "remote", transport: "streamable-http", url: service.url, credentialRefs: {}, enabled: false, tools: [{ name: "echo", effect: "remote", exposure: "deferred" }], resources: [{ uri: "mcp://remote/readme", mimeTypes: ["text/plain"] }] };
    let state = await f.mcp({ type: "save", revision: 0, server });
    state = await f.mcp({ type: "credential", revision: state.revision, name: "remote", envName: "MCP_TOKEN", value: service.token });
    state = await f.mcp({ type: "enable", revision: state.revision, name: "remote", enabled: true });
    return { f, service, server: state.servers[0], close: async (options) => { try { await f.close(options); } finally { await service.close(); } } };
  } catch (error) { if (f) await f.close(); await service.close(); throw error; }
}
