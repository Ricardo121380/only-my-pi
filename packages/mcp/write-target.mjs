import fs from "node:fs/promises";
import path from "node:path";
import { digest, MCP_LIMITS, mcpError } from "./catalog.mjs";

export async function openWriteTarget({ project, value, scopes, configRoot, files, workspacePolicy }) {
  if (typeof value !== "string" || !value || value.length > 512 || path.isAbsolute(value) || /[\0\\]/u.test(value) || value.split("/").some((part) => !part || part === "." || part === ".." || /^(?:\.git|\.pi|\.env)(?:$|\.)/u.test(part))) throw mcpError("MCP_PATH_DENIED");
  const target = path.resolve(project, value);
  if (!target.startsWith(project + path.sep) || target === configRoot || target.startsWith(configRoot + path.sep) || workspacePolicy?.inspectPath(target, { cwd: project })) throw mcpError("MCP_PATH_DENIED");
  const allowed = scopes.some((scope) => target === path.resolve(project, scope) || target.startsWith(path.resolve(project, scope) + path.sep));
  if (!allowed) throw mcpError("MCP_PATH_DENIED");
  let cursor = project;
  for (const component of value.split("/")) { cursor = path.join(cursor, component); if ((await fs.lstat(cursor)).isSymbolicLink()) throw mcpError("MCP_LINK_DENIED"); }
  const handle = await fs.open(target, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    if (!identity.isFile() || identity.nlink !== 1 || identity.size > MCP_LIMITS.serverFileBytes) throw mcpError("MCP_WRITE_TARGET_NOT_ADMITTED");
    for (const file of files) { const code = await fs.stat(file.path); if (code.dev === identity.dev && code.ino === identity.ino) throw mcpError("MCP_CODE_WRITE_DENIED"); }
    const bytes = async () => { const stat = await handle.stat(); if (stat.size > MCP_LIMITS.serverFileBytes) throw mcpError("MCP_FILE_LIMIT"); const data = Buffer.alloc(stat.size); await handle.read(data, 0, data.length, 0); return digest(data); };
    const beforeDigest = await bytes();
    const verifyIdentity = async () => {
      const stat = await fs.lstat(target), current = await handle.stat();
      if (stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || current.nlink !== 1 || await fs.realpath(target) !== target) throw mcpError("MCP_TARGET_CHANGED");
    };
    const assert = async () => { await verifyIdentity(); if (await bytes() !== beforeDigest) throw mcpError("MCP_TARGET_CHANGED"); };
    await assert();
    return { handle, target, beforeDigest, fileIdentity: digest([identity.dev, identity.ino]), assert, verifyIdentity, digest: bytes };
  } catch (error) { await handle.close(); throw error; }
}
