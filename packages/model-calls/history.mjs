import fs from "node:fs/promises";
import { canonicalJson } from "../config-runtime/index.mjs";
import { hostError } from "../host/contracts.mjs";
import { ModelCallStore } from "./store.mjs";
import { ImageArtifacts } from "./artifacts.mjs";

export class SessionImages {
  constructor(configRoot, catalog) { this.configRoot = configRoot; this.catalog = catalog; this.store = new ImageArtifacts(configRoot); }
  async references(projectId, sessionKey) {
    const project = this.catalog.project(projectId), branch = await this.catalog.imageReferences(sessionKey, projectId);
    const ledger = await new ModelCallStore(this.configRoot).status(project.path);
    return { project, branch, requests: ledger.tasks.flatMap(task => task.requests).filter(request => request.kind === "image") };
  }
  match(requests, artifact, projectPath) {
    const expected = requests.find(request => request.requestId === artifact.requestId)?.storage?.artifacts?.[artifact.index];
    if (artifact.projectPath !== projectPath || !expected || canonicalJson(artifact) !== canonicalJson(expected)) throw hostError("IMAGE_SOURCE_UNAVAILABLE", 409);
    return expected;
  }
  async read({ projectId, sessionKey, entryId, requestId, index }) {
    const { project, branch, requests } = await this.references(projectId, sessionKey);
    const reference = branch.entries.find(entry => entry.entryId === entryId), artifact = reference?.artifacts.find(a => a.requestId === requestId && a.index === index);
    if (!artifact) throw hostError("IMAGE_REFERENCE_NOT_FOUND", 404);
    this.match(requests, artifact, project.path);
    return this.store.read(project.path, requestId, index, artifact);
  }
  async list(projectId, sessionKey) {
    const { project, branch, requests } = await this.references(projectId, sessionKey), images = [];
    for (const reference of branch.entries) for (const artifact of reference.artifacts) {
      let state = "available", error;
      try { this.match(requests, artifact, project.path); await this.store.read(project.path, artifact.requestId, artifact.index, artifact); }
      catch (cause) { state = "unavailable"; error = cause.code ?? "IMAGE_ARTIFACT_UNAVAILABLE"; }
      images.push({ entryId: reference.entryId, artifact, shared: artifact.sessionId !== branch.sessionId, state, storageStatus: requests.find(r => r.requestId === artifact.requestId)?.storage?.status, ...(error ? { error } : {}) });
    }
    const space = await fs.statfs(this.configRoot).then(stat => Number(stat.bavail) * Number(stat.bsize), () => null);
    return { sessionId: branch.sessionId, images, space: { availableBytes: space, referencedBytes: images.reduce((n, i) => n + i.artifact.bytes, 0), scope: "OMP session artifacts", cleanup: "EXPLICIT_ONLY" }, minimumReader: "Pi 1.1.0 / OMP image ledger v2" };
  }
}
