import fs from "node:fs/promises";
import path from "node:path";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { mcpError } from "./catalog.mjs";
import { NATIVE_PI_VERSIONS } from "../upstream-compatibility/native-pi.mjs";

export async function loadNativeMcp(sdkFile, entry = ".") {
  if (![".", "./oauth"].includes(entry)) throw mcpError("MCP_RUNTIME_BINDING_REQUIRED");
  if (!path.isAbsolute(sdkFile ?? "")) throw mcpError("MCP_RUNTIME_BINDING_REQUIRED");
  const pi = JSON.parse(await fs.readFile(path.resolve(path.dirname(sdkFile), "../package.json"), "utf8"));
  const manifest = findPackageJSON("@earendil-works/pi-mcp", pathToFileURL(sdkFile));
  const mcp = JSON.parse(await fs.readFile(manifest, "utf8"));
  if (pi.name !== "@earendil-works/pi-coding-agent" || !NATIVE_PI_VERSIONS.includes(pi.version) || mcp.name !== "@earendil-works/pi-mcp" || mcp.version !== pi.version) throw mcpError("MCP_RUNTIME_VERSION_MISMATCH");
  return import(pathToFileURL(path.resolve(path.dirname(manifest), mcp.exports[entry].import)).href);
}
