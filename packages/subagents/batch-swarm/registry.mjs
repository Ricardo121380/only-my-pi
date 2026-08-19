import fsPromises from "node:fs/promises";
import path from "node:path";

import { createAgentRegistry } from "../../agent-registry/index.mjs";
import {
  agentTemplateFromRegistryEntry,
  createResolvedAgentSpec,
  digestValue,
} from "../domain/index.mjs";
import {
  assertBatchSwarmResources,
  BatchSwarmError,
} from "./index.mjs";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_TEMPLATE_BYTES = 128 * 1024;

export class BatchSwarmRegistryError extends Error {
  constructor(message, code = "BATCH_SWARM_REGISTRY_ERROR", details = {}) {
    super(`batch-swarm-registry: ${message}`);
    this.name = "BatchSwarmRegistryError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new BatchSwarmRegistryError(message, code, details);
}

function normalizeRoot(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    fail(`${label} must be an absolute path`, "INVALID_BATCH_ROOT");
  }
  return path.resolve(value);
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`path escapes batch registry root: ${target}`, "BATCH_RESOURCE_ESCAPE");
  }
  return path.resolve(target);
}

function normalizeFs(source = fsPromises) {
  for (const method of ["readdir", "readFile", "lstat", "realpath"]) {
    if (typeof source?.[method] !== "function") fail(`filesystem lacks ${method}()`, "BATCH_FILESYSTEM_UNAVAILABLE");
  }
  return source;
}

async function lstatOrNull(fs, target) {
  try {
    return await fs.lstat(target);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

async function assertSafeFile(fs, root, target) {
  const absoluteRoot = normalizeRoot(root, "resource root");
  const absoluteTarget = contained(absoluteRoot, target);
  const rootStat = await lstatOrNull(fs, absoluteRoot);
  if (!rootStat?.isDirectory?.() || rootStat.isSymbolicLink?.()) fail(`unsafe resource root: ${absoluteRoot}`, "BATCH_RESOURCE_ESCAPE");
  let current = absoluteRoot;
  for (const segment of path.relative(absoluteRoot, absoluteTarget).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(fs, current);
    if (!stat || stat.isSymbolicLink?.()) fail(`unsafe or missing batch resource: ${current}`, "BATCH_RESOURCE_ESCAPE");
  }
  const targetStat = await fs.lstat(absoluteTarget);
  if (!targetStat.isFile?.()) fail(`batch resource is not a regular file: ${absoluteTarget}`, "BATCH_RESOURCE_TYPE");
  contained(await fs.realpath(absoluteRoot), await fs.realpath(absoluteTarget));
  return absoluteTarget;
}

async function readBounded(fs, root, target, maximumBytes) {
  const safe = await assertSafeFile(fs, root, target);
  const contents = await fs.readFile(safe);
  if (contents.byteLength > maximumBytes) fail(`batch resource exceeds ${maximumBytes} bytes: ${safe}`, "BATCH_RESOURCE_TOO_LARGE");
  return contents.toString("utf8");
}

async function jsonFiles(fs, root) {
  const stat = await lstatOrNull(fs, root);
  if (!stat) return [];
  if (!stat.isDirectory?.() || stat.isSymbolicLink?.()) fail(`unsafe batch directory: ${root}`, "BATCH_RESOURCE_ESCAPE");
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink?.()) fail(`symlink is not allowed in batch registry: ${entry.name}`, "BATCH_RESOURCE_ESCAPE");
    if (entry.isFile?.() && entry.name.endsWith(".json") && !entry.name.startsWith(".")) files.push(path.join(root, entry.name));
    else if (!entry.isFile?.()) fail(`batch registry accepts top-level JSON files only: ${entry.name}`, "BATCH_RESOURCE_TYPE");
  }
  return files;
}

function exactResolvedSpec(generated, stored) {
  const { specHash: ignored, ...projection } = generated;
  const expected = { ...projection, contractStatus: stored.contractStatus };
  const expectedWithHash = { ...expected, specHash: digestValue(expected) };
  return digestValue(expectedWithHash) === digestValue(stored);
}

export class BatchSwarmRegistry {
  constructor(options = {}) {
    this.rootDir = normalizeRoot(options.rootDir ?? process.cwd(), "rootDir");
    this.fs = normalizeFs(options.fs);
    this.batchRoot = normalizeRoot(options.batchRoot ?? path.join(this.rootDir, "swarm", "batches"), "batchRoot");
    this.templateRoot = normalizeRoot(options.templateRoot ?? path.join(this.rootDir, "swarm", "templates"), "templateRoot");
    this.agentSpecRoot = normalizeRoot(options.agentSpecRoot ?? path.join(this.rootDir, "swarm", "agent-specs"), "agentSpecRoot");
    this.agentRegistry = options.agentRegistry ?? createAgentRegistry({ rootDir: this.rootDir, fs: this.fs });
    this.state = null;
  }

  async discover() {
    const definitions = [];
    for (const file of await jsonFiles(this.fs, this.batchRoot)) {
      let definition;
      try {
        definition = JSON.parse(await readBounded(this.fs, this.batchRoot, file, MAX_JSON_BYTES));
      } catch (cause) {
        if (cause instanceof SyntaxError) fail(`invalid batch JSON: ${path.basename(file)}`, "INVALID_BATCH_RESOURCE");
        throw cause;
      }
      const agentSpecFile = path.join(this.agentSpecRoot, `${definition.agentSpecRef}.json`);
      const templateFile = path.join(this.templateRoot, `${definition.promptTemplateRef}.txt`);
      let agentSpec;
      try {
        agentSpec = JSON.parse(await readBounded(this.fs, this.agentSpecRoot, agentSpecFile, MAX_JSON_BYTES));
      } catch (cause) {
        if (cause instanceof SyntaxError) fail(`invalid AgentSpec JSON for ${definition.id}`, "INVALID_BATCH_AGENT_SPEC");
        throw cause;
      }
      const promptTemplate = await readBounded(this.fs, this.templateRoot, templateFile, MAX_TEMPLATE_BYTES);
      let bound;
      try {
        bound = assertBatchSwarmResources(definition, agentSpec, promptTemplate);
      } catch (cause) {
        if (cause instanceof BatchSwarmError) fail(cause.message, cause.code, { cause });
        throw cause;
      }
      const agentEntry = await this.agentRegistry.resolve(agentSpec.templateId);
      const generated = createResolvedAgentSpec({
        template: agentTemplateFromRegistryEntry(agentEntry),
        id: agentSpec.id,
      });
      if (!exactResolvedSpec(generated, agentSpec)) {
        fail(`ResolvedAgentSpec ${agentSpec.id} drifted from registered agent ${agentSpec.templateId}`, "BATCH_AGENT_REGISTRY_DRIFT");
      }
      const sourceHash = digestValue({
        definitionDigest: bound.definitionDigest,
        agentSpecHash: agentSpec.specHash,
        promptTemplateHash: definition.promptTemplateHash,
      });
      if (definitions.some((entry) => entry.id === definition.id)) fail(`duplicate batch id: ${definition.id}`, "DUPLICATE_BATCH_ID");
      definitions.push(Object.freeze({
        id: definition.id,
        definition: bound.definition,
        definitionDigest: bound.definitionDigest,
        agentSpec: bound.agentSpec,
        promptTemplate,
        sourceHash,
        source: {
          definition: path.relative(this.rootDir, file).split(path.sep).join("/"),
          agentSpec: path.relative(this.rootDir, agentSpecFile).split(path.sep).join("/"),
          promptTemplate: path.relative(this.rootDir, templateFile).split(path.sep).join("/"),
        },
      }));
    }
    definitions.sort((left, right) => left.id.localeCompare(right.id));
    this.state = new Map(definitions.map((entry) => [entry.id, entry]));
    return Object.freeze(definitions);
  }

  async list() {
    if (!this.state) await this.discover();
    return Object.freeze([...this.state.values()]);
  }

  async resolve(id) {
    if (!this.state) await this.discover();
    const entry = this.state.get(id);
    if (!entry) fail(`unknown BatchSwarm: ${id}`, "UNKNOWN_BATCH_SWARM");
    return entry;
  }

  async resolveAgentSpec(id) {
    const matches = (await this.list()).filter((entry) => entry.agentSpec.id === id);
    if (matches.length === 0) fail(`unknown BatchSwarm AgentSpec: ${id}`, "UNKNOWN_BATCH_AGENT_SPEC");
    if (matches.some((entry) => entry.agentSpec.specHash !== matches[0].agentSpec.specHash)) {
      fail(`BatchSwarm AgentSpec ${id} has conflicting definitions`, "BATCH_AGENT_SPEC_CONFLICT");
    }
    return matches[0].agentSpec;
  }

  async resolvePromptTemplate(id) {
    const matches = (await this.list()).filter((entry) => entry.definition.promptTemplateRef === id);
    if (matches.length === 0) fail(`unknown BatchSwarm prompt template: ${id}`, "UNKNOWN_BATCH_PROMPT_TEMPLATE");
    if (matches.some((entry) => entry.definition.promptTemplateHash !== matches[0].definition.promptTemplateHash)) {
      fail(`BatchSwarm prompt template ${id} has conflicting definitions`, "BATCH_PROMPT_TEMPLATE_CONFLICT");
    }
    return matches[0].promptTemplate;
  }

  async doctor() {
    try {
      const batches = await this.discover();
      return Object.freeze({ ok: true, status: "BATCH_SWARM_DOCTOR_PASS", count: batches.length, errors: [] });
    } catch (cause) {
      if (cause instanceof BatchSwarmRegistryError) {
        return Object.freeze({ ok: false, status: "BATCH_SWARM_DOCTOR_FAIL", code: cause.code, message: cause.message, errors: cause.details?.errors ?? [] });
      }
      throw cause;
    }
  }
}

export function createBatchSwarmRegistry(options = {}) {
  return new BatchSwarmRegistry(options);
}
