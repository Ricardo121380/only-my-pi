import fs from "node:fs/promises";
import path from "node:path";
import { McpCatalog, mcpError } from "./catalog.mjs";
import { McpRuns } from "./runs.mjs";
import { secretInput } from "../control-service/secret-input.mjs";
import { McpOAuth } from "./oauth.mjs";

export const MCP_USAGE = `omp mcp list|status [--project /absolute/project]
omp mcp preview /absolute/raw.json [--project /absolute/project]
omp mcp import /absolute/raw.json --revision N --digest SHA256 [--project /absolute/project]
omp mcp apply /absolute/action.json [--project /absolute/project]
omp mcp enable|disable|reset NAME --revision N [--project /absolute/project]
omp mcp logout NAME --project /absolute/project --revision N [--env MCP_TOKEN]
omp mcp credential NAME --project /absolute/project --revision N [--env MCP_TOKEN] [--stdin]
omp mcp login|refresh NAME --project /absolute/project --revision N [--timeout-ms 120000]
omp mcp auth-status NAME --project /absolute/project
Credentials use hidden terminal input or explicit --stdin, never action files or arguments.
Saving, importing or authenticating does not enable a server or authorize a tool.`;

// The same configuration version interface serves CLI, TUI and WebUI. None
// of these configuration commands creates an MCP client or starts a process.
export async function prepareMcpCommand(args) {
  if (args === "list" || args === "status" || !args) return { type: args || "list" };
  const match = /^(apply|preview) (\/[^\0\r\n]+)$/u.exec(args);
  if (!match) throw mcpError("MCP_COMMAND_USAGE");
  const file = match[2], stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > 65536) throw mcpError("MCP_INPUT_LIMIT");
  const text = await fs.readFile(file, "utf8");
  if (match[1] === "preview") return { type: "previewImport", source: text };
  let input; try { input = JSON.parse(text); } catch { throw mcpError("MCP_COMMAND_INVALID"); }
  if (input?.projectId !== undefined || input?.type === "credential") throw mcpError("MCP_COMMAND_NOT_ADMITTED");
  return input;
}
export async function mcpCommand(configRoot, input, projectPath) {
  const project = projectPath ? await fs.realpath(projectPath) : undefined;
  if (project && !(await fs.stat(project)).isDirectory()) throw mcpError("MCP_PROJECT_INVALID");
  return input.type === "status" ? new McpRuns(configRoot).status(project) : new McpCatalog(configRoot).action(input, project);
}
export async function runMcpCli({ argv, configRoot, resolveStack, stdin = process.stdin, stderr = process.stderr }) {
  const args = [], flags = {};
  const authenticating = ["login", "refresh"].includes(argv[0]);
  const allowed = argv[0] === "credential" ? ["--project", "--revision", "--env", "--stdin"]
    : authenticating ? ["--project", "--revision", "--timeout-ms"]
    : argv[0] === "import" ? ["--project", "--revision", "--digest"]
    : argv[0] === "logout" ? ["--project", "--revision", "--env"]
    : ["enable", "disable", "reset"].includes(argv[0]) ? ["--project", "--revision"] : ["--project"];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) { args.push(flag); continue; }
    if (!allowed.includes(flag) || Object.hasOwn(flags, flag)) throw mcpError("MCP_COMMAND_USAGE");
    flags[flag] = flag === "--stdin" ? true : argv[++i];
    if (flags[flag] === undefined || typeof flags[flag] === "string" && flags[flag].startsWith("--")) throw mcpError("MCP_COMMAND_USAGE");
  }
  const project = flags["--project"];
  if (project !== undefined && !path.isAbsolute(project)) throw mcpError("MCP_COMMAND_USAGE");
  if (args[0] === "help" && args.length === 1) return { usage: MCP_USAGE };
  if (args[0] === "auth-status") {
    if (args.length !== 2 || !project) throw mcpError("MCP_COMMAND_USAGE");
    const canonical = await fs.realpath(project), catalog = new McpCatalog(configRoot);
    if (!(await fs.stat(canonical)).isDirectory()) throw mcpError("MCP_PROJECT_INVALID");
    await new McpOAuth({ catalog }).initialize();
    const snapshot = await catalog.snapshot(canonical), authentication = snapshot.authentication[args[1]];
    if (!authentication) throw mcpError("MCP_OAUTH_HTTP_REQUIRED");
    return { revision: snapshot.revision, projectPath: canonical, name: args[1], ...authentication };
  }
  if (["import", "enable", "disable", "reset", "logout"].includes(args[0])) {
    const revision = Number(flags["--revision"]);
    if (args.length !== 2 || !Number.isSafeInteger(revision) || revision < 0) throw mcpError("MCP_COMMAND_USAGE");
    let input;
    if (args[0] === "import") {
      if (!/^[a-f0-9]{64}$/u.test(flags["--digest"] ?? "")) throw mcpError("MCP_COMMAND_USAGE");
      const preview = await prepareMcpCommand(`preview ${args[1]}`);
      input = { type: "import", source: preview.source, digest: flags["--digest"], revision };
    } else if (args[0] === "logout") input = { type: "revokeCredential", name: args[1], envName: flags["--env"] ?? "MCP_TOKEN", revision };
    else if (args[0] === "reset") input = { type: "reset", name: args[1], revision };
    else input = { type: "enable", name: args[1], enabled: args[0] === "enable", revision };
    return mcpCommand(configRoot, input, project);
  }
  if (authenticating) {
    const revision = Number(flags["--revision"]), timeoutMs = flags["--timeout-ms"] === undefined ? 120000 : Number(flags["--timeout-ms"]);
    if (args.length !== 2 || !project || !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw mcpError("MCP_COMMAND_USAGE");
    const canonical = await fs.realpath(project);
    if (!(await fs.stat(canonical)).isDirectory()) throw mcpError("MCP_PROJECT_INVALID");
    const stack = await resolveStack(), catalog = new McpCatalog(configRoot);
    const oauth = new McpOAuth({ catalog, sdkFile: path.join(stack.root, "pi/dist/index.js"), timeoutMs });
    let flow, cancellation, cancelled = false;
    const cancel = () => {
      cancelled = true;
      cancellation ??= oauth.stop(); cancellation.catch(() => {});
    };
    process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
    try {
      await oauth.initialize();
      if (cancelled) return { status: "cancelled" };
      flow = await oauth.start(args[1], canonical, revision, args[0] === "refresh" ? "refresh" : "login");
      if (cancelled) cancel();
      else if (flow.status === "waiting") stderr.write(`Open in your browser: ${await oauth.open(flow.flowId)}\nCtrl+C cancels this login.\n`);
      return await oauth.wait(flow.flowId, canonical);
    } catch (error) {
      if (cancelled && flow) return await oauth.wait(flow.flowId, canonical);
      if (cancelled && error.code === "MCP_OAUTH_STOPPING") return { status: "cancelled", code: "MCP_OAUTH_CANCELLED" };
      throw error;
    } finally {
      try { await cancellation; }
      finally {
        try { await oauth.stop(); }
        finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
      }
    }
  }
  if (args[0] === "credential") {
    const revision = Number(flags["--revision"]);
    if (args.length !== 2 || !project || !Number.isSafeInteger(revision) || revision < 0) throw mcpError("MCP_COMMAND_USAGE");
    const controller = new AbortController(), cancel = () => controller.abort();
    process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
    let input;
    try {
      input = secretInput(stdin, stderr, controller, flags["--stdin"] === true, (code, status) => mcpError(`MCP_${code}`, status));
      const value = await input.read("MCP credential");
      if (controller.signal.aborted) throw mcpError("MCP_AUTH_CANCELLED", 409);
      return await mcpCommand(configRoot, { type: "credential", name: args[1], envName: flags["--env"] ?? "MCP_TOKEN", value, revision }, project);
    } finally { input?.close(); process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
  }
  if (args.length > 2 || (args.length === 2 && !["preview", "apply"].includes(args[0]))) throw mcpError("MCP_COMMAND_USAGE");
  const input = await prepareMcpCommand(args.join(" "));
  return mcpCommand(configRoot, input, project);
}
