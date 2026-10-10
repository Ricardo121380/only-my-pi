import fs from "node:fs/promises";
import path from "node:path";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { mcpError } from "./catalog.mjs";

export async function loadNativeMcp(sdkFile) {
  if (!path.isAbsolute(sdkFile ?? "")) throw mcpError("MCP_RUNTIME_BINDING_REQUIRED");
  const pi = JSON.parse(await fs.readFile(path.resolve(path.dirname(sdkFile), "../package.json"), "utf8"));
  const manifest = findPackageJSON("@earendil-works/pi-mcp", pathToFileURL(sdkFile));
  const mcp = JSON.parse(await fs.readFile(manifest, "utf8"));
  if (pi.name !== "@earendil-works/pi-coding-agent" || pi.version !== "1.1.0" || mcp.name !== "@earendil-works/pi-mcp" || mcp.version !== "1.1.0") throw mcpError("MCP_RUNTIME_VERSION_MISMATCH");
  return import(pathToFileURL(path.resolve(path.dirname(manifest), mcp.exports["."].import)).href);
}
