import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectCatalog, projectIdFor } from "../host/catalog.mjs";
import { hostEndpoint } from "../host/cli.mjs";
import { hostError } from "../host/contracts.mjs";
import { SessionImages } from "./history.mjs";

export async function imageArtifactCommand({ configRoot, projectPath, args }) {
  if (["history", "download"].includes(args[0])) {
    const file = args[1]; if (!path.isAbsolute(file ?? "") || (args[0] === "history" ? args.length !== 2 : args.length !== 5 || !/^[0-3]$/u.test(args[4]))) throw hostError("IMAGE_HISTORY_COMMAND_USAGE");
    const catalog = new ProjectCatalog({ sessionRoot: path.dirname(file) }); await catalog.add(projectPath); await catalog.scan();
    const projectId = projectIdFor(projectPath), sessionKey = createHash("sha256").update(file).digest("hex"), images = new SessionImages(configRoot, catalog);
    if (args[0] === "history") return images.list(projectId, sessionKey);
    return (await images.read({ projectId, sessionKey, entryId: args[2], requestId: args[3], index: Number(args[4]) })).bytes;
  }
  if (args[0] !== "export") throw hostError("IMAGE_ARTIFACT_COMMAND_USAGE");
  let input;
  if (args[1] === "prepare" && args.length === 3 && path.isAbsolute(args[2])) {
    const stat = await fs.lstat(args[2]); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16384) throw hostError("IMAGE_EXPORT_CONFIG_INVALID");
    const value = JSON.parse(await fs.readFile(args[2], "utf8"));
    if (Object.keys(value).sort().join() !== "entryId,index,path,requestId,sessionKey") throw hostError("IMAGE_EXPORT_CONFIG_INVALID");
    input = { type: "prepare", projectId: projectIdFor(projectPath), ...value };
  } else if (args[1] === "commit" && (args.length === 4 || args.length === 5) && args[3] === "--confirm-write" && (args.length === 4 || args[4] === "--overwrite")) {
    input = { type: "commit", operationId: args[2], codingAuthorized: true, overwrite: args.length === 5 };
  } else if (["reconcile", "cancel"].includes(args[1]) && args.length === 3) input = { type: args[1], operationId: args[2] };
  else throw hostError("IMAGE_EXPORT_COMMAND_USAGE");
  const endpoint = await hostEndpoint(configRoot); if (!endpoint) throw hostError("HOST_NOT_RUNNING", 409);
  const response = await fetch(`${endpoint.origin}/internal/image-export`, { method: "POST", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${endpoint.controlToken}`, "content-type": "application/json", "x-omp-image-export-protocol": "1" }, body: JSON.stringify({ projectId: projectIdFor(projectPath), command: input }) });
  const result = await response.json(); if (!response.ok) throw hostError(result.code ?? "IMAGE_EXPORT_FAILED", response.status);
  return result;
}
