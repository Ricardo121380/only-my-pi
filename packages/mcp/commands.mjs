import fs from "node:fs/promises";
import path from "node:path";
import { McpCatalog, mcpError } from "./catalog.mjs";
import { McpRuns } from "./runs.mjs";

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
export async function runMcpCli({ argv, configRoot }) {
  let project, args = argv;
  const index = args.indexOf("--project");
  if (index !== -1) {
    project = args[index + 1];
    if (!path.isAbsolute(project ?? "") || args.indexOf("--project", index + 1) !== -1) throw mcpError("MCP_COMMAND_USAGE");
    args = [...args.slice(0, index), ...args.slice(index + 2)];
  }
  if (args.length > 2 || (args.length === 2 && !["preview", "apply"].includes(args[0]))) throw mcpError("MCP_COMMAND_USAGE");
  const input = await prepareMcpCommand(args.join(" "));
  return mcpCommand(configRoot, input, project);
}
