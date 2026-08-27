import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";

import modeSchema from "../../schemas/mode-v1.schema.json" with { type: "json" };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const QUALIFIED_ID = /^(?:user|project):[a-z0-9][a-z0-9-]{0,63}$|^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63})?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_PROMPT_BYTES = 256 * 1024;
const ROOT_SOURCE_KINDS = new Set(["builtin", "user", "trusted-project"]);
const SOURCE_KINDS = new Set(["builtin", "user", "trusted-project", "reviewed-package"]);
const TOOL_SET = new Set(["read", "grep", "find", "ls", "edit", "write", "bash", "web"]);
const EGRESS_KEYS = ["web", "mcp", "provider", "extension"];
const HARD_POLICY_PATHS = Object.freeze([
  "executionState",
  "policy.workspace",
  "policy.approval",
  "policy.egress.web",
  "policy.egress.mcp",
  "policy.egress.provider",
  "policy.egress.extension",
  "policy.egress.network",
  "tools.allow",
  "tools.deny",
  "tools.required",
  "requires.profileCapabilities",
  "requires.packages",
  "requires.enforcementSurfaces",
]);

const WORKSPACE_RANK = Object.freeze({
  none: 0,
  "read-only": 1,
  "guarded-write": 2,
  "worktree-write": 3,
});
const APPROVAL_RANK = Object.freeze({ deny: 0, ask: 1, inherit: 2 });
const EGRESS_RANK = Object.freeze({ deny: 0, "allow-listed": 1, inherit: 2 });
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });

export const MODE_REGISTRY_FORMAT_VERSION = 1;
export const MODE_SOURCE_KINDS = Object.freeze([...SOURCE_KINDS]);
export const MODE_TOOL_NAMES = Object.freeze([...TOOL_SET]);
export const MODE_HARD_POLICY_PATHS = HARD_POLICY_PATHS;

export class ModeRegistryError extends Error {
  constructor(message, code, details = {}) {
    super(`mode-registry: ${message}`);
    this.name = "ModeRegistryError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new ModeRegistryError(message, code, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function statFlag(stat, name) {
  if (!stat) return false;
  return typeof stat[name] === "function" ? stat[name]() : stat[name] === true;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sortedUnique(values, label) {
  if (!Array.isArray(values)) fail("INVALID_MODE_MANIFEST", `${label} must be an array`);
  const output = [...values];
  const seen = new Set();
  for (const value of output) {
    if (typeof value !== "string") fail("INVALID_MODE_MANIFEST", `${label} contains a non-string value`);
    if (seen.has(value)) fail("DUPLICATE_MODE_VALUE", `${label} contains duplicate ${value}`);
    seen.add(value);
  }
  return output.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

const MODE_TOP_KEYS = new Set([
  "$schema", "formatVersion", "contractStatus", "id", "aliases", "version",
  "displayName", "description", "category", "executionState", "extends",
  "requires", "prompt", "tools", "policy", "workflow", "swarm", "completion", "risk",
]);
const MODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MODE_SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const MODE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[A-Za-z0-9._@/-]+$/u;
const MODE_SURFACE_PATTERN = /^[a-z][A-Za-z0-9-]{0,63}$/u;
const MODE_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write", "bash", "web"]);
const MODE_RECEIPT_TOP_KEYS = new Set(["formatVersion", "modeId", "hash", "sourceHash", "snapshot"]);
const MODE_RECEIPT_SNAPSHOT_KEYS = new Set(["formatVersion", "modeId", "rawModeId", "sourceHash", "lineage", "resolved"]);

function shapeError(errors, instancePath, message, keyword = "schema") {
  errors.push({ instancePath, keyword, message });
}

function requireObject(value, instancePath, errors) {
  if (!isObject(value)) {
    shapeError(errors, instancePath, "must be an object", "type");
    return false;
  }
  return true;
}

function checkKeys(value, allowed, instancePath, errors) {
  for (const key of Object.keys(value ?? {})) {
    if (!allowed.has(key)) shapeError(errors, instancePath, `must NOT have additional property '${key}'`, "additionalProperties");
  }
}

function checkRequired(value, required, instancePath, errors) {
  for (const key of required) {
    if (!Object.hasOwn(value ?? {}, key)) shapeError(errors, `${instancePath}/${key}`, "must have required property", "required");
  }
}

function checkString(value, instancePath, errors, { pattern, minLength = 0, maxLength = Infinity } = {}) {
  if (typeof value !== "string") {
    shapeError(errors, instancePath, "must be a string", "type");
    return false;
  }
  if (value.length < minLength) shapeError(errors, instancePath, `must NOT have fewer than ${minLength} characters`, "minLength");
  if (value.length > maxLength) shapeError(errors, instancePath, `must NOT have more than ${maxLength} characters`, "maxLength");
  if (pattern && !pattern.test(value)) shapeError(errors, instancePath, "must match pattern", "pattern");
  return true;
}

function checkEnum(value, values, instancePath, errors) {
  if (!values.includes(value)) shapeError(errors, instancePath, `must be equal to one of the allowed values`, "enum");
}

function checkIdArray(value, instancePath, errors, pattern = MODE_ID_PATTERN) {
  if (!Array.isArray(value)) {
    shapeError(errors, instancePath, "must be an array", "type");
    return;
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemPath = `${instancePath}/${index}`;
    if (!checkString(item, itemPath, errors, { pattern })) continue;
    if (seen.has(item)) shapeError(errors, itemPath, "must NOT have duplicate items", "uniqueItems");
    seen.add(item);
  }
}

function validateModeShape(manifest) {
  const errors = [];
  if (!requireObject(manifest, "", errors)) return errors;
  checkKeys(manifest, MODE_TOP_KEYS, "", errors);
  checkRequired(manifest, [
    "$schema", "formatVersion", "contractStatus", "id", "version", "displayName", "description",
    "category", "executionState", "extends", "requires", "prompt", "tools", "policy", "workflow",
    "swarm", "completion", "risk",
  ], "", errors);
  checkString(manifest.$schema, "/$schema", errors, { pattern: /mode-v1\.schema\.json$/u });
  if (manifest.formatVersion !== 1) shapeError(errors, "/formatVersion", "must be equal to constant", "const");
  checkEnum(manifest.contractStatus, ["contract-only", "runtime-ready"], "/contractStatus", errors);
  checkString(manifest.id, "/id", errors, { pattern: MODE_ID_PATTERN });
  if (manifest.aliases !== undefined) checkIdArray(manifest.aliases, "/aliases", errors);
  checkString(manifest.version, "/version", errors, { pattern: MODE_SEMVER_PATTERN });
  checkString(manifest.displayName, "/displayName", errors, { minLength: 1, maxLength: 80 });
  checkString(manifest.description, "/description", errors, { minLength: 1, maxLength: 500 });
  checkEnum(manifest.category, ["core", "core-plus", "labs"], "/category", errors);
  checkEnum(manifest.executionState, ["ask", "plan", "build", "review"], "/executionState", errors);
  checkIdArray(manifest.extends, "/extends", errors);

  if (requireObject(manifest.requires, "/requires", errors)) {
    checkKeys(manifest.requires, new Set(["profileCapabilities", "packages", "enforcementSurfaces"]), "/requires", errors);
    checkRequired(manifest.requires, ["profileCapabilities", "packages", "enforcementSurfaces"], "/requires", errors);
    checkIdArray(manifest.requires.profileCapabilities, "/requires/profileCapabilities", errors);
    checkIdArray(manifest.requires.packages, "/requires/packages", errors);
    checkIdArray(manifest.requires.enforcementSurfaces, "/requires/enforcementSurfaces", errors, MODE_SURFACE_PATTERN);
  }
  if (requireObject(manifest.prompt, "/prompt", errors)) {
    checkKeys(manifest.prompt, new Set(["file"]), "/prompt", errors);
    checkRequired(manifest.prompt, ["file"], "/prompt", errors);
    checkString(manifest.prompt.file, "/prompt/file", errors, { pattern: MODE_PATH_PATTERN, minLength: 1, maxLength: 240 });
  }
  if (requireObject(manifest.tools, "/tools", errors)) {
    checkKeys(manifest.tools, new Set(["allow", "deny", "required"]), "/tools", errors);
    checkRequired(manifest.tools, ["allow", "deny", "required"], "/tools", errors);
    for (const key of ["allow", "deny", "required"]) checkIdArray(manifest.tools[key], `/tools/${key}`, errors, /^[a-z]+$/u);
    for (const key of ["allow", "deny", "required"]) {
      for (const tool of manifest.tools[key] ?? []) if (!MODE_TOOLS.has(tool)) shapeError(errors, `/tools/${key}`, `contains unknown tool '${tool}'`, "enum");
    }
  }
  if (requireObject(manifest.policy, "/policy", errors)) {
    checkKeys(manifest.policy, new Set(["workspace", "egress", "approval"]), "/policy", errors);
    checkRequired(manifest.policy, ["workspace", "egress", "approval"], "/policy", errors);
    checkEnum(manifest.policy.workspace, ["none", "read-only", "guarded-write", "worktree-write"], "/policy/workspace", errors);
    checkEnum(manifest.policy.approval, ["deny", "ask", "inherit"], "/policy/approval", errors);
    if (requireObject(manifest.policy.egress, "/policy/egress", errors)) {
      checkKeys(manifest.policy.egress, new Set(["web", "mcp", "network", "provider", "extension"]), "/policy/egress", errors);
      checkRequired(manifest.policy.egress, ["web", "mcp", "provider", "extension"], "/policy/egress", errors);
      for (const key of ["web", "mcp", "network", "extension"]) {
        if (manifest.policy.egress[key] !== undefined) checkEnum(manifest.policy.egress[key], ["deny", "allow-listed", "inherit"], `/policy/egress/${key}`, errors);
      }
      checkEnum(manifest.policy.egress.provider, ["deny", "inherit"], "/policy/egress/provider", errors);
    }
  }
  if (requireObject(manifest.workflow, "/workflow", errors)) {
    checkKeys(manifest.workflow, new Set(["default", "fallback"]), "/workflow", errors);
    checkRequired(manifest.workflow, ["default", "fallback"], "/workflow", errors);
    checkString(manifest.workflow.default, "/workflow/default", errors, { pattern: MODE_ID_PATTERN });
    checkString(manifest.workflow.fallback, "/workflow/fallback", errors, { pattern: MODE_ID_PATTERN });
  }
  if (requireObject(manifest.swarm, "/swarm", errors)) {
    checkKeys(manifest.swarm, new Set(["allowed", "defaultRecipe"]), "/swarm", errors);
    checkRequired(manifest.swarm, ["allowed", "defaultRecipe"], "/swarm", errors);
    if (typeof manifest.swarm.allowed !== "boolean") shapeError(errors, "/swarm/allowed", "must be boolean", "type");
    if (manifest.swarm.defaultRecipe !== null) checkString(manifest.swarm.defaultRecipe, "/swarm/defaultRecipe", errors, { pattern: MODE_ID_PATTERN });
  }
  if (requireObject(manifest.completion, "/completion", errors)) {
    checkKeys(manifest.completion, new Set(["gates", "requiresStructuredVerdict"]), "/completion", errors);
    checkRequired(manifest.completion, ["gates", "requiresStructuredVerdict"], "/completion", errors);
    checkIdArray(manifest.completion.gates, "/completion/gates", errors);
    if (!Array.isArray(manifest.completion.gates) || manifest.completion.gates.length < 1) shapeError(errors, "/completion/gates", "must contain at least 1 item", "minItems");
    if (manifest.completion.requiresStructuredVerdict !== true) shapeError(errors, "/completion/requiresStructuredVerdict", "must be equal to constant", "const");
  }
  checkEnum(manifest.risk, ["low", "medium", "high"], "/risk", errors);
  return errors;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathInside(root, candidate, code = "MODE_PATH_ESCAPE", options = {}) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absolute);
  if ((!relative && options.allowEqual !== true)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    fail(code, `path escapes trusted mode root: ${candidate}`);
  }
  return absolute;
}

function normalizeRoot(root, label) {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0") || !path.isAbsolute(root)) {
    fail("INVALID_MODE_ROOT", `${label} must be an explicit absolute path`);
  }
  return path.resolve(root);
}

function normalizeFs(input) {
  const source = input ?? fsPromises;
  const required = ["readdir", "readFile", "lstat"];
  for (const name of required) {
    if (typeof source[name] !== "function") fail("FILESYSTEM_DRIVER_UNAVAILABLE", `filesystem driver lacks ${name}`);
  }
  return Object.freeze({
    readdir: (...args) => source.readdir(...args),
    readFile: (...args) => source.readFile(...args),
    lstat: (...args) => source.lstat(...args),
    realpath: typeof source.realpath === "function" ? (...args) => source.realpath(...args) : null,
    mkdir: typeof source.mkdir === "function" ? (...args) => source.mkdir(...args) : null,
    writeFile: typeof source.writeFile === "function" ? (...args) => source.writeFile(...args) : null,
  });
}

async function lstatOrNull(fs, target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonOrNull(fs, target) {
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) fail("INVALID_MODE_CATALOG", `cannot parse catalog: ${target}`, { cause: error });
    throw error;
  }
}

async function assertRealContained(fs, root, target, options = {}) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = pathInside(absoluteRoot, target, "MODE_PATH_ESCAPE", {
    allowEqual: options.allowEqual === true || options.directory === true,
  });
  const rootStat = await lstatOrNull(fs, absoluteRoot);
  if (!rootStat || !statFlag(rootStat, "isDirectory") || statFlag(rootStat, "isSymbolicLink")) {
    fail("MODE_PATH_ESCAPE", `mode root is missing or unsafe: ${absoluteRoot}`);
  }
  const relative = path.relative(absoluteRoot, absoluteTarget);
  const parts = relative.split(path.sep);
  let current = absoluteRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = await lstatOrNull(fs, current);
    if (!stat) {
      if (options.allowMissingLeaf && index === parts.length - 1) return absoluteTarget;
      fail("MODE_RESOURCE_MISSING", `mode resource is missing: ${path.relative(absoluteRoot, current)}`);
    }
    if (statFlag(stat, "isSymbolicLink")) fail("MODE_SYMLINK_ESCAPE", `mode resource is a symlink: ${path.relative(absoluteRoot, current)}`);
    if (index < parts.length - 1 && !statFlag(stat, "isDirectory")) {
      fail("MODE_PATH_ESCAPE", `mode resource parent is not a directory: ${path.relative(absoluteRoot, current)}`);
    }
    if (index === parts.length - 1 && options.file && !statFlag(stat, "isFile")) {
      fail("MODE_RESOURCE_TYPE", `mode resource is not a regular file: ${path.relative(absoluteRoot, current)}`);
    }
    if (index === parts.length - 1 && options.directory && !statFlag(stat, "isDirectory")) {
      fail("MODE_RESOURCE_TYPE", `mode resource is not a directory: ${path.relative(absoluteRoot, current)}`);
    }
  }
  if (fs.realpath) {
    const realRoot = path.resolve(await fs.realpath(absoluteRoot));
    const realTarget = path.resolve(await fs.realpath(absoluteTarget));
    pathInside(realRoot, realTarget, "MODE_SYMLINK_ESCAPE", { allowEqual: true });
  }
  return absoluteTarget;
}

function sourceNamespace(kind, packageId) {
  if (kind === "builtin") return "";
  if (kind === "user") return "user:";
  if (kind === "trusted-project") return "project:";
  if (kind === "reviewed-package") return `${packageId}/`;
  return "";
}

function qualifyId(manifestId, kind, packageId) {
  return `${sourceNamespace(kind, packageId)}${manifestId}`;
}

function normalizeCatalog(catalog, label) {
  if (catalog === undefined || catalog === null) return new Set();
  if (catalog instanceof Set) catalog = [...catalog];
  if (isObject(catalog) && Array.isArray(catalog.ids)) catalog = catalog.ids;
  if (isObject(catalog) && Array.isArray(catalog.capabilities)) catalog = catalog.capabilities;
  if (isObject(catalog) && Array.isArray(catalog.packages)) catalog = catalog.packages;
  if (isObject(catalog) && Array.isArray(catalog.surfaces)) catalog = catalog.surfaces;
  const values = Array.isArray(catalog)
    ? catalog.map((entry) => typeof entry === "string" ? entry : entry?.id)
    : isObject(catalog)
      ? Object.keys(catalog)
      : null;
  if (!values || values.some((value) => typeof value !== "string" || value.length === 0)) {
    fail("INVALID_MODE_CATALOG", `${label} must be an array of ids or id records`);
  }
  return new Set(values);
}

function normalizeCapabilities(input) {
  return normalizeCatalog(input, "capabilities");
}

function normalizeSource(source, index) {
  if (!isObject(source)) fail("INVALID_MODE_SOURCE", `mode source ${index} must be an object`);
  const kind = source.kind;
  if (!SOURCE_KINDS.has(kind)) fail("INVALID_MODE_SOURCE", `unknown mode source kind: ${String(kind)}`);
  if (kind === "reviewed-package") {
    if (typeof source.packageId !== "string" || !ID.test(source.packageId)) {
      fail("INVALID_MODE_SOURCE", "reviewed package source requires a canonical packageId");
    }
    if (source.reviewed !== true) fail("UNTRUSTED_MODE_SOURCE", `package ${source.packageId} is not reviewed`);
  }
  const normalizedRoot = source.root === undefined ? undefined : normalizeRoot(source.root, `${kind} root`);
  if (kind === "trusted-project" && source.trusted !== true) {
    fail("UNTRUSTED_MODE_SOURCE", "project Modes require an explicit trusted=true source");
  }
  if (source.modes !== undefined && !Array.isArray(source.modes)) {
    fail("INVALID_MODE_SOURCE", "inline mode source must provide a modes array");
  }
  return Object.freeze({ ...source, root: normalizedRoot, index });
}

function normalizeSources(options) {
  const raw = options.sources === undefined || options.sources === null
    ? []
    : Array.isArray(options.sources)
      ? [...options.sources]
      : fail("INVALID_MODE_SOURCE", "sources must be an array");
  if (!Array.isArray(raw)) fail("INVALID_MODE_SOURCE", "sources must be an array");
  const searchRoots = options.searchRoots;
  if (searchRoots !== undefined) {
    if (Array.isArray(searchRoots)) raw.push(...searchRoots.map((entry) => typeof entry === "string" ? { kind: "builtin", root: entry } : entry));
    else if (isObject(searchRoots)) {
      const aliases = {
        builtin: "builtin",
        builtIn: "builtin",
        user: "user",
        trustedProject: "trusted-project",
        "trusted-project": "trusted-project",
        reviewedPackage: "reviewed-package",
        "reviewed-package": "reviewed-package",
      };
      for (const [key, value] of Object.entries(searchRoots)) {
        const kind = aliases[key] ?? key;
        if (Array.isArray(value)) {
          for (const root of value) raw.push(typeof root === "string" ? { kind, root } : { ...root, kind });
        } else if (value !== undefined && value !== null) {
          raw.push(typeof value === "string" ? { kind, root: value } : { ...value, kind });
        }
      }
    } else fail("INVALID_MODE_SOURCE", "searchRoots must be an array or object");
  }
  const sources = raw.map((source, index) => normalizeSource(source, index));
  if (options.builtInRoot) sources.unshift(normalizeSource({ kind: "builtin", root: options.builtInRoot }, -1));
  if (options.userRoot) sources.push(normalizeSource({ kind: "user", root: options.userRoot }, -1));
  if (options.trustedProjectRoot) {
    sources.push(normalizeSource({ kind: "trusted-project", root: options.trustedProjectRoot, trusted: options.projectTrusted === true }, -1));
  }
  if (options.projectRoot && !sources.some((source) => source.kind === "trusted-project")) {
    sources.push(normalizeSource({
      kind: "trusted-project",
      root: path.join(normalizeRoot(options.projectRoot, "projectRoot"), ".pi", "only-my-pi", "modes"),
      trusted: options.projectTrusted === true,
      optional: true,
    }, -4));
  }
  if (options.reviewedPackages !== undefined && !Array.isArray(options.reviewedPackages)) {
    fail("INVALID_MODE_SOURCE", "reviewedPackages must be an array");
  }
  for (const packageSource of options.reviewedPackages ?? []) {
    sources.push(normalizeSource({ ...packageSource, kind: "reviewed-package", reviewed: packageSource.reviewed ?? true }, -1));
  }
  if (options.configRoot && !sources.some((source) => source.kind === "user")) {
    const configRoot = normalizeRoot(options.configRoot, "configRoot");
    // The caller must opt into a configRoot (normally PI_CODING_AGENT_DIR);
    // never infer or touch the real home directory implicitly.
    sources.push(normalizeSource({ kind: "user", root: path.join(configRoot, "only-my-pi", "modes"), optional: true }, -3));
  }
  if (options.rootDir && !sources.some((source) => source.kind === "builtin")) {
    const rootDir = normalizeRoot(options.rootDir, "rootDir");
    sources.push(normalizeSource({ kind: "builtin", root: path.join(rootDir, "modes"), optional: true }, -2));
  }
  const order = { builtin: 0, user: 1, "trusted-project": 2, "reviewed-package": 3 };
  return sources.sort((left, right) => (order[left.kind] - order[right.kind]) || left.index - right.index);
}

function validateModeManifest(manifest, context = {}) {
  const shapeErrors = validateModeShape(manifest);
  if (shapeErrors.length > 0) {
    fail("INVALID_MODE_MANIFEST", `${context.label ?? "mode"} does not satisfy mode-v1 schema`, {
      errors: shapeErrors,
    });
  }
  if (!ID.test(manifest.id)) fail("INVALID_MODE_MANIFEST", "mode id is not canonical");
  const aliases = manifest.aliases ?? [];
  sortedUnique(aliases, "aliases");
  if (aliases.some((alias) => !ID.test(alias))) fail("INVALID_MODE_MANIFEST", "mode aliases must be canonical ids");
  for (const field of ["extends", "requires.profileCapabilities", "requires.packages", "requires.enforcementSurfaces"]) {
    const value = field.split(".").reduce((current, key) => current?.[key], manifest);
    sortedUnique(value, field);
  }
  const tools = manifest.tools;
  for (const field of ["allow", "deny", "required"]) sortedUnique(tools[field], `tools.${field}`);
  const overlaps = tools.allow.filter((tool) => tools.deny.includes(tool));
  if (overlaps.length > 0) fail("TOOL_POLICY_CONFLICT", `tools allow/deny overlap: ${overlaps.join(", ")}`);
  if (tools.deny.some((tool) => !TOOL_SET.has(tool)) || tools.allow.some((tool) => !TOOL_SET.has(tool))) {
    fail("INVALID_MODE_MANIFEST", "mode contains an unknown tool");
  }
  if (tools.required.some((tool) => !tools.allow.includes(tool) || tools.deny.includes(tool))) {
    fail("TOOL_POLICY_CONFLICT", "required tools must be allowed and not denied");
  }
  for (const key of EGRESS_KEYS) {
    if (!Object.hasOwn(manifest.policy.egress, key)) fail("INVALID_MODE_MANIFEST", `policy.egress.${key} is required`);
  }
  const allow = new Set(tools.allow);
  const workspaceTools = new Set(["read", "grep", "find", "ls", "edit", "write", "bash"]);
  if (manifest.policy.workspace === "none" && [...allow].some((tool) => workspaceTools.has(tool))) {
    fail("MODE_POLICY_ESCALATION", "workspace=none cannot expose workspace tools", { tools: [...allow].filter((tool) => workspaceTools.has(tool)) });
  }
  if (manifest.policy.workspace === "read-only" && ["edit", "write", "bash"].some((tool) => allow.has(tool))) {
    fail("MODE_POLICY_ESCALATION", "read-only workspace cannot expose mutating tools", { tools: [...allow] });
  }
  if (allow.has("bash") && !manifest.requires.enforcementSurfaces.includes("bashSandbox")) {
    fail("EGRESS_SURFACE_REQUIRED", "bash tool requires bashSandbox enforcement surface");
  }
  if (["edit", "write"].some((tool) => allow.has(tool)) && !manifest.requires.enforcementSurfaces.includes("fileToolPolicy")) {
    fail("EGRESS_SURFACE_REQUIRED", "mutating file tools require fileToolPolicy enforcement surface");
  }
  if (allow.has("web") && manifest.policy.egress.web === "deny") {
    fail("EGRESS_TOOL_CONFLICT", "web tool requires non-deny web egress");
  }
  if (allow.has("web") && manifest.policy.egress.web !== "deny" && !manifest.requires.enforcementSurfaces.includes("webEgress")) {
    fail("EGRESS_SURFACE_REQUIRED", "web tool requires webEgress enforcement surface");
  }
  return manifest;
}

function canonicalizeManifest(manifest) {
  const output = clone(manifest);
  for (const field of ["extends", "aliases"]) output[field] = sortedUnique(output[field] ?? [], field);
  for (const field of ["profileCapabilities", "packages", "enforcementSurfaces"]) {
    output.requires[field] = sortedUnique(output.requires[field], `requires.${field}`);
  }
  for (const field of ["allow", "deny", "required"]) output.tools[field] = sortedUnique(output.tools[field], `tools.${field}`);
  output.completion.gates = sortedUnique(output.completion.gates, "completion.gates");
  return output;
}

function maxRisk(left, right) {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

function union(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])].sort(compareText);
}

function restrictValue(parent, child, rank, label) {
  if (child === undefined) return parent;
  if (parent === undefined || parent === "inherit") return child;
  if (child === "inherit") return parent;
  if (rank[child] > rank[parent]) fail("MODE_POLICY_ESCALATION", `${label} widens inherited policy`, { parent, child });
  return child;
}

function mergeTools(parent, child) {
  const parentAllow = parent?.allow ?? [...TOOL_SET];
  const childAllow = child?.allow ?? parentAllow;
  const allow = parentAllow.filter((tool) => childAllow.includes(tool)).sort();
  const deny = union(parent?.deny, child?.deny).filter((tool) => TOOL_SET.has(tool));
  const effectiveAllow = allow.filter((tool) => !deny.includes(tool));
  const required = union(parent?.required, child?.required);
  if (required.some((tool) => !effectiveAllow.includes(tool) || deny.includes(tool))) {
    fail("TOOL_POLICY_CONFLICT", "inherited required tool is not available in the effective allow set");
  }
  return { allow: effectiveAllow, deny, required };
}

function mergePolicy(parent, child) {
  const parentPolicy = parent ?? {};
  const childPolicy = child ?? {};
  const parentEgress = parentPolicy.egress ?? {};
  const childEgress = childPolicy.egress ?? {};
  const egress = {};
  for (const key of EGRESS_KEYS) egress[key] = restrictValue(parentEgress[key], childEgress[key], EGRESS_RANK, `policy.egress.${key}`);
  if (Object.hasOwn(parentEgress, "network") || Object.hasOwn(childEgress, "network")) {
    egress.network = restrictValue(parentEgress.network, childEgress.network, EGRESS_RANK, "policy.egress.network");
  }
  return {
    workspace: restrictValue(parentPolicy.workspace, childPolicy.workspace, WORKSPACE_RANK, "policy.workspace"),
    egress,
    approval: restrictValue(parentPolicy.approval, childPolicy.approval, APPROVAL_RANK, "policy.approval"),
  };
}

function mergeSwarm(parent, child) {
  if (!parent) return clone(child);
  if (!child) return clone(parent);
  if (parent.allowed === false && child.allowed === true) fail("MODE_POLICY_ESCALATION", "swarm cannot be enabled by a child mode");
  return {
    allowed: parent.allowed && child.allowed,
    defaultRecipe: child.defaultRecipe ?? parent.defaultRecipe ?? null,
  };
}

function mergeManifests(parent, child) {
  if (!parent) return clone(child);
  const merged = clone(child);
  merged.requires = {
    profileCapabilities: union(parent.requires.profileCapabilities, child.requires.profileCapabilities),
    packages: union(parent.requires.packages, child.requires.packages),
    enforcementSurfaces: union(parent.requires.enforcementSurfaces, child.requires.enforcementSurfaces),
  };
  merged.prompt = clone(child.prompt ?? parent.prompt);
  merged.tools = mergeTools(parent.tools, child.tools);
  merged.policy = mergePolicy(parent.policy, child.policy);
  merged.swarm = mergeSwarm(parent.swarm, child.swarm);
  merged.completion = {
    gates: union(parent.completion.gates, child.completion.gates),
    requiresStructuredVerdict: true,
  };
  merged.aliases = union(parent.aliases, child.aliases);
  merged.extends = [];
  merged.risk = maxRisk(parent.risk, child.risk);
  return merged;
}

function normalizeProfile(profile) {
  if (profile === undefined || profile === null) return null;
  if (!isObject(profile)) fail("INVALID_PROFILE_CEILING", "profile ceiling must be an object");
  const capabilityValues = profile.capabilities instanceof Set
    ? [...profile.capabilities]
    : profile.capabilityIds ?? profile.capabilities ?? [];
  const packageValues = profile.packages instanceof Set
    ? [...profile.packages]
    : profile.packageIds ?? profile.packages ?? [];
  // The constructor stores a normalized profile using Sets.  `resolve()` may
  // normalize that same profile again, so accept the internal representation
  // as an idempotent input rather than treating it as malformed user data.
  if (!(Array.isArray(capabilityValues) || capabilityValues instanceof Set)
    || !(Array.isArray(packageValues) || packageValues instanceof Set)) {
    fail("INVALID_PROFILE_CEILING", "profile capability/package ceiling must be arrays");
  }
  const capabilities = new Set(capabilityValues);
  const packages = new Set(packageValues);
  if ([...capabilities, ...packages].some((value) => typeof value !== "string")) fail("INVALID_PROFILE_CEILING", "profile ceiling ids must be strings");
  const policy = profile.policy ?? {};
  if (!isObject(policy)) fail("INVALID_PROFILE_CEILING", "profile policy ceiling must be an object");
  return { capabilities, packages, policy };
}

function assertCatalogRequirements(manifest, catalogs) {
  for (const capability of manifest.requires.profileCapabilities) {
    if (!catalogs.capabilities.has(capability)) {
      fail("UNKNOWN_CAPABILITY", `mode requires unknown capability: ${capability}`);
    }
  }
  for (const packageId of manifest.requires.packages) {
    if (!catalogs.packages.has(packageId)) {
      fail("UNKNOWN_PACKAGE", `mode requires unknown package: ${packageId}`);
    }
  }
  for (const surface of manifest.requires.enforcementSurfaces) {
    if (!catalogs.surfaces.has(surface)) {
      fail("UNKNOWN_ENFORCEMENT_SURFACE", `mode requires unknown enforcement surface: ${surface}`);
    }
  }
}

function assertProfileCeiling(manifest, profile) {
  if (!profile) return;
  for (const capability of manifest.requires.profileCapabilities) {
    if (!profile.capabilities.has(capability)) fail("PROFILE_CEILING_EXCEEDED", `mode requires capability outside profile ceiling: ${capability}`);
  }
  for (const packageId of manifest.requires.packages) {
    if (!profile.packages.has(packageId)) fail("PROFILE_CEILING_EXCEEDED", `mode requires package outside profile ceiling: ${packageId}`);
  }
  const ceiling = profile.policy;
  if (ceiling.workspace !== undefined && !Object.hasOwn(WORKSPACE_RANK, ceiling.workspace)) fail("INVALID_PROFILE_CEILING", "profile workspace ceiling is unknown");
  if (ceiling.approval !== undefined && !Object.hasOwn(APPROVAL_RANK, ceiling.approval)) fail("INVALID_PROFILE_CEILING", "profile approval ceiling is unknown");
  const knownNetworks = new Set(["deny", "deny-unless-test-case", "deny-unless-explicit", "allow-listed-only", "public-ssrf-guarded"]);
  if (ceiling.network !== undefined && (typeof ceiling.network !== "string" || !knownNetworks.has(ceiling.network))) fail("INVALID_PROFILE_CEILING", "profile network ceiling is unknown");
  if (ceiling.workspace && WORKSPACE_RANK[manifest.policy.workspace] > WORKSPACE_RANK[ceiling.workspace]) {
    fail("PROFILE_CEILING_EXCEEDED", "mode workspace policy exceeds profile ceiling");
  }
  if (ceiling.approval && manifest.policy.approval !== "inherit" && APPROVAL_RANK[manifest.policy.approval] > APPROVAL_RANK[ceiling.approval]) {
    fail("PROFILE_CEILING_EXCEEDED", "mode approval policy exceeds profile ceiling");
  }
  const profileTools = ceiling.tools;
  if (Array.isArray(profileTools)) {
    for (const tool of manifest.tools.allow) {
      if (!profileTools.includes(tool)) fail("PROFILE_CEILING_EXCEEDED", `mode allows tool outside profile ceiling: ${tool}`);
    }
  }
  const network = ceiling.network;
  const webToolUsesNetwork = manifest.tools.allow.includes("web") && manifest.policy.egress.web === "inherit";
  if (network === "deny" && (webToolUsesNetwork || Object.values(manifest.policy.egress).some((value) => value === "allow-listed"))) {
    fail("PROFILE_CEILING_EXCEEDED", "mode egress exceeds profile network deny ceiling");
  }
  if (network === "deny-unless-test-case" && (webToolUsesNetwork || Object.values(manifest.policy.egress).some((value) => value === "allow-listed"))) {
    fail("PROFILE_CEILING_EXCEEDED", "mode allow-listed egress exceeds test-case-only profile ceiling");
  }
  if (isObject(ceiling.egress)) {
    for (const key of EGRESS_KEYS) {
      const ceilingValue = ceiling.egress[key];
      const modeValue = manifest.policy.egress[key];
      if (ceilingValue === "deny" && modeValue === "allow-listed") {
        fail("PROFILE_CEILING_EXCEEDED", `mode egress ${key} exceeds profile ceiling`);
      }
    }
  }
}

function assertEgressSurfaceRequirements(manifest) {
  const egress = manifest.policy.egress;
  const requirements = [
    ["web", "webEgress"],
    ["mcp", "mcpEgress"],
    ["provider", "providerEgress"],
    ["extension", "extensionEgress"],
  ];
  for (const [key, surface] of requirements) {
    if (egress[key] === "allow-listed" && !manifest.requires.enforcementSurfaces.includes(surface)) {
      fail("EGRESS_SURFACE_REQUIRED", `policy.egress.${key} requires enforcement surface ${surface}`);
    }
  }
  if (egress.network === "allow-listed" && !["webEgress", "mcpEgress", "providerEgress"].some((surface) => manifest.requires.enforcementSurfaces.includes(surface))) {
    fail("EGRESS_SURFACE_REQUIRED", "policy.egress.network requires a network egress enforcement surface");
  }
}

function policyProjection(manifest) {
  return {
    workspace: manifest.policy.workspace,
    approval: manifest.policy.approval,
    egress: clone(manifest.policy.egress),
    tools: clone(manifest.tools),
  };
}

function diffValue(from, to, prefix, output) {
  if (canonicalJson(from) === canonicalJson(to)) return;
  if (isObject(from) && isObject(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    for (const key of keys) diffValue(from[key], to[key], prefix ? `${prefix}.${key}` : key, output);
    return;
  }
  output.push({ path: prefix, from: clone(from), to: clone(to) });
}

function asResolvedSnapshot(value) {
  if (!value || !isObject(value)) return null;
  if (value.resolved && value.snapshot) return value;
  if (value.resolved && value.modeId) {
    return { ...value, hash: value.hash ?? sha256(canonicalJson(value)) };
  }
  return null;
}

/**
 * Build the bounded, low-sensitivity session receipt used to restore a mode.
 *
 * The receipt intentionally excludes prompt text, prompt paths, provider
 * configuration, cwd, and host filesystem locations.  It is a comparison
 * record, not a second source of truth: on restore the current registry must
 * resolve the mode again and produce the same hash/sourceHash before any
 * prompt is injected.
 */
export function createModeReceipt(target) {
  const resolved = target?.resolved ?? target?.snapshot?.resolved;
  if (!target || typeof target.modeId !== "string" || typeof target.hash !== "string" || typeof target.sourceHash !== "string" || !isObject(resolved)) {
    fail("INVALID_MODE_RECEIPT", "cannot create a mode receipt from an incomplete resolved target");
  }
  const snapshot = {
    formatVersion: MODE_REGISTRY_FORMAT_VERSION,
    modeId: target.modeId,
    rawModeId: target.snapshot?.rawModeId ?? target.rawModeId ?? target.modeId,
    sourceHash: target.sourceHash,
    lineage: (target.lineage ?? target.snapshot?.lineage ?? []).map((entry) => ({
      id: entry.id,
      sourceHash: entry.sourceHash,
    })),
    // Keep only policy/tool/capability projections.  In particular, do not
    // copy `resolved.prompt` or any source path into the durable receipt.
    resolved: {
      executionState: resolved.executionState,
      requires: clone(resolved.requires),
      tools: clone(resolved.tools),
      policy: clone(resolved.policy),
      workflow: clone(resolved.workflow),
      swarm: clone(resolved.swarm),
      completion: clone(resolved.completion),
      risk: resolved.risk,
    },
  };
  const receipt = {
    formatVersion: MODE_REGISTRY_FORMAT_VERSION,
    modeId: target.modeId,
    hash: target.hash,
    sourceHash: target.sourceHash,
    snapshot,
  };
  if (Buffer.byteLength(canonicalJson(receipt), "utf8") > 64 * 1024) {
    fail("MODE_RECEIPT_TOO_LARGE", "mode receipt exceeds the 64 KiB session bound");
  }
  return deepFreeze(receipt);
}

export function validateModeReceipt(receipt) {
  const errors = [];
  if (!isObject(receipt)) return { valid: false, errors: ["receipt must be an object"] };
  for (const key of Object.keys(receipt)) if (!MODE_RECEIPT_TOP_KEYS.has(key)) errors.push(`unknown receipt field: ${key}`);
  if (receipt.formatVersion !== MODE_REGISTRY_FORMAT_VERSION) errors.push("receipt formatVersion is unsupported");
  if (typeof receipt.modeId !== "string" || !QUALIFIED_ID.test(receipt.modeId)) errors.push("receipt modeId is invalid");
  if (typeof receipt.hash !== "string" || !SHA256.test(receipt.hash)) errors.push("receipt hash is invalid");
  if (typeof receipt.sourceHash !== "string" || !SHA256.test(receipt.sourceHash)) errors.push("receipt sourceHash is invalid");
  if (!isObject(receipt.snapshot)) errors.push("receipt snapshot is missing");
  else {
    for (const key of Object.keys(receipt.snapshot)) if (!MODE_RECEIPT_SNAPSHOT_KEYS.has(key)) errors.push(`unknown receipt snapshot field: ${key}`);
    if (receipt.snapshot.formatVersion !== MODE_REGISTRY_FORMAT_VERSION) errors.push("receipt snapshot formatVersion is unsupported");
    if (receipt.snapshot.modeId !== receipt.modeId) errors.push("receipt snapshot modeId does not match receipt");
    if (receipt.snapshot.sourceHash !== receipt.sourceHash) errors.push("receipt snapshot sourceHash does not match receipt");
    if (!isObject(receipt.snapshot.resolved)) errors.push("receipt snapshot resolved projection is missing");
    if (!Array.isArray(receipt.snapshot.lineage)) errors.push("receipt snapshot lineage is invalid");
    else for (const entry of receipt.snapshot.lineage) {
      if (!isObject(entry) || typeof entry.id !== "string" || typeof entry.sourceHash !== "string" || !SHA256.test(entry.sourceHash)) {
        errors.push("receipt snapshot lineage contains an invalid entry");
        break;
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function hardEnvelope(snapshot) {
  return {
    policy: clone(snapshot.resolved.policy),
    tools: clone(snapshot.resolved.tools),
    requires: clone(snapshot.resolved.requires),
  };
}

function normalizeSourceHash(value) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INVALID_MODE_SOURCE_HASH", "mode source hash must be sha256");
  return value;
}

function modeReferenceCandidates(reference, entry, registry) {
  const candidates = [];
  const local = entry ? qualifyId(reference, entry.source.kind, entry.source.packageId) : null;
  if (local && local !== reference && registry.entries.has(local)) {
    // A package's unqualified extends reference is local to that package;
    // this avoids accidentally inheriting a built-in with the same raw ID.
    candidates.push(local);
  } else if (registry.entries.has(reference)) {
    candidates.push(reference);
  }
  if (registry.aliases.has(reference)) candidates.push(registry.aliases.get(reference));
  return [...new Set(candidates)];
}

function resolveReference(reference, entry, registry) {
  const candidates = modeReferenceCandidates(reference, entry, registry);
  if (candidates.length === 0) fail("UNKNOWN_MODE_REFERENCE", `mode extends unknown mode: ${reference}`);
  if (candidates.length > 1) fail("AMBIGUOUS_MODE_REFERENCE", `mode reference is ambiguous: ${reference}`, { candidates });
  return candidates[0];
}

async function discoverRootSource(registry, source) {
  if (Array.isArray(source.modes)) {
    return source.modes.map((manifest, index) => ({ manifest, file: null, source, index }));
  }
  if (!source.root) return [];
  const root = source.root;
  const rootStat = await lstatOrNull(registry.fs, root);
  if (!rootStat) {
    if (source.optional === true) return [];
    fail("MODE_ROOT_MISSING", `required mode root is missing: ${root}`);
  }
  await assertRealContained(registry.fs, root, root, { directory: true, allowEqual: true });
  const output = [];
  async function visit(directory) {
    const entries = await registry.fs.readdir(directory, { withFileTypes: true });
    for (const dirent of [...entries].sort((left, right) => compareText(left.name, right.name))) {
      const target = path.join(directory, dirent.name);
      pathInside(root, target);
      const stat = await lstatOrNull(registry.fs, target);
      if (!stat) continue;
      if (statFlag(stat, "isSymbolicLink")) fail("MODE_SYMLINK_ESCAPE", `mode source contains symlink: ${path.relative(root, target)}`);
      if (statFlag(stat, "isDirectory")) {
        await visit(target);
      } else if (statFlag(stat, "isFile") && dirent.name.endsWith(".json")) {
        let manifest;
        try {
          manifest = JSON.parse(await registry.fs.readFile(target, "utf8"));
        } catch (cause) {
          fail("INVALID_MODE_MANIFEST", `cannot parse mode manifest: ${path.relative(root, target)}`, { cause });
        }
        output.push({ manifest, file: target, source, index: output.length });
      }
    }
  }
  await visit(root);
  return output;
}

async function loadPrompt(registry, candidate) {
  const promptPath = candidate.manifest.prompt.file;
  if (!candidate.file) {
    return Object.freeze({ path: promptPath, hash: sha256(""), content: null });
  }
  const root = candidate.source.root;
  const localCandidate = path.resolve(path.dirname(candidate.file), promptPath);
  let resolved;
  try {
    resolved = await assertRealContained(registry.fs, root, localCandidate, { file: true });
  } catch (error) {
    // A repository-level built-in manifest may use `modes/prompts/x.md`
    // while a package-local manifest uses `prompts/x.md`.  Permit the former
    // only as a contained fallback; traversal/symlink errors remain fatal.
    if (!new Set(["MODE_RESOURCE_MISSING", "MODE_RESOURCE_TYPE"]).has(error?.code)) throw error;
    if (!root || !promptPath.startsWith(`${path.basename(root)}${path.sep}`) && !promptPath.startsWith(`${path.basename(root)}/`)) throw error;
    const rootRelative = path.resolve(path.dirname(root), promptPath);
    resolved = await assertRealContained(registry.fs, root, rootRelative, { file: true });
  }
  const content = await registry.fs.readFile(resolved, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_PROMPT_BYTES) {
    fail("MODE_RESOURCE_TOO_LARGE", `mode prompt exceeds ${MAX_PROMPT_BYTES} bytes: ${path.relative(root, resolved)}`);
  }
  return Object.freeze({
    path: path.relative(root, resolved).split(path.sep).join("/"),
    hash: sha256(content),
    content,
  });
}

async function candidateToEntry(registry, candidate) {
  validateModeManifest(candidate.manifest, { label: candidate.file ?? `${candidate.source.kind} inline mode` });
  const manifest = canonicalizeManifest(candidate.manifest);
  const qualifiedId = qualifyId(manifest.id, candidate.source.kind, candidate.source.packageId);
  const prompt = await loadPrompt(registry, { ...candidate, manifest });
  const manifestHash = sha256(canonicalJson(manifest));
  const sourceHash = sha256(canonicalJson({ manifestHash, prompt: { path: prompt.path, hash: prompt.hash } }));
  return Object.freeze({
    key: qualifiedId,
    rawId: manifest.id,
    aliases: [...(manifest.aliases ?? [])],
    manifest,
    source: Object.freeze({
      kind: candidate.source.kind,
      root: candidate.source.root ?? null,
      packageId: candidate.source.packageId ?? null,
      file: candidate.file,
      trusted: candidate.source.kind === "builtin" || candidate.source.kind === "user" || candidate.source.trusted === true,
    }),
    sourceHash,
    prompt,
  });
}

function buildRegistryState(entries, catalogs) {
  const byKey = new Map();
  const rawIds = new Map();
  const aliases = new Map();
  for (const entry of entries) {
    if (byKey.has(entry.key)) fail("DUPLICATE_MODE_ID", `duplicate mode id: ${entry.key}`);
    const previous = rawIds.get(entry.rawId) ?? [];
    // Built-in IDs are reserved. Namespaced reviewed packages may reuse a raw
    // ID, but an unqualified reference then becomes ambiguous and cannot
    // silently select one package.
    if (previous.length > 0 && (entry.source.kind === "builtin" || previous.some((key) => byKey.get(key)?.source.kind === "builtin"))) {
      fail("DUPLICATE_MODE_ID", `mode id collision across sources: ${entry.rawId}`, {
        first: previous,
        second: entry.key,
      });
    }
    byKey.set(entry.key, entry);
    rawIds.set(entry.rawId, [...previous, entry.key]);
  }
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (byKey.has(alias) || aliases.has(alias) || rawIds.has(alias)) fail("DUPLICATE_MODE_ALIAS", `mode alias collision: ${alias}`);
      aliases.set(alias, entry.key);
    }
  }
  return {
    entries: byKey,
    aliases,
    rawIds,
    catalogs,
    discovered: true,
  };
}

function lineageHash(lineage) {
  return sha256(canonicalJson(lineage.map((entry) => ({ id: entry.id, sourceHash: entry.sourceHash }))));
}

function effectiveExecutionState(parent, child) {
  if (!parent) return child;
  const rank = { ask: 0, review: 0, plan: 1, build: 2 };
  if ((rank[child] ?? 99) > (rank[parent] ?? 99)) {
    fail("MODE_POLICY_ESCALATION", `executionState ${child} widens parent ${parent}`);
  }
  return child;
}

function explainDecisions(lineage, resolved) {
  return [
    ...lineage.map((entry) => ({ type: "inheritance", mode: entry.id, sourceHash: entry.sourceHash })),
    { type: "tool-intersection", allow: [...resolved.tools.allow], deny: [...resolved.tools.deny] },
    { type: "capability-union", required: [...resolved.requires.profileCapabilities] },
    { type: "package-union", required: [...resolved.requires.packages] },
    { type: "surface-union", required: [...resolved.requires.enforcementSurfaces] },
  ];
}

class ModeRegistry {
  constructor(options = {}) {
    this.options = { ...options };
    this.fs = normalizeFs(options.fs);
    this.rootDir = options.rootDir === undefined ? null : normalizeRoot(options.rootDir, "rootDir");
    this.catalogOptions = {
      capabilities: options.capabilities ?? options.capabilityIds ?? options.catalogs?.capabilities,
      packages: options.packages ?? options.packageIds ?? options.catalogs?.packages,
      surfaces: options.enforcementSurfaces ?? options.surfaceIds ?? options.surfaces ?? options.catalogs?.surfaces,
    };
    this.sources = normalizeSources(options);
    this.catalogs = {
      capabilities: this.catalogOptions.capabilities === undefined ? null : normalizeCapabilities(this.catalogOptions.capabilities),
      packages: this.catalogOptions.packages === undefined ? null : normalizeCatalog(this.catalogOptions.packages, "packages"),
      surfaces: this.catalogOptions.surfaces === undefined ? null : normalizeCatalog(this.catalogOptions.surfaces, "enforcement surfaces"),
    };
    this.profile = normalizeProfile(options.profile);
    this.state = null;
  }

  async #loadCatalogs() {
    const loaded = { ...this.catalogs };
    const rootDir = this.rootDir;
    if (rootDir) {
      const read = async (relative) => readJsonOrNull(this.fs, path.join(rootDir, relative));
      if (loaded.capabilities === null) {
        const document = await read("policies/capabilities.v1.json");
        loaded.capabilities = normalizeCatalog(document?.capabilities ?? [], "capabilities");
      }
      if (loaded.packages === null) {
        const document = await read("inventory/packages.lock.json");
        loaded.packages = normalizeCatalog(document?.packages ?? [], "packages");
      }
      if (loaded.surfaces === null) {
        const document = await read("policies/enforcement-surfaces.v1.json");
        loaded.surfaces = normalizeCatalog(document?.surfaces ?? [], "enforcement surfaces");
      }
    }
    // A missing catalog is deliberately an empty allow-list.  This makes
    // standalone/injected registries fail closed for every declared
    // capability/package/surface until the caller supplies a catalog.
    for (const key of ["capabilities", "packages", "surfaces"]) {
      if (loaded[key] === null) loaded[key] = new Set();
    }
    this.catalogs = loaded;
    return loaded;
  }

  async discover(options = {}) {
    const catalogs = await this.#loadCatalogs();
    const candidates = [];
    for (const source of this.sources) candidates.push(...await discoverRootSource(this, source));
    const entries = [];
    for (const candidate of candidates) {
      const entry = await candidateToEntry(this, candidate);
      assertCatalogRequirements(entry.manifest, catalogs);
      assertEgressSurfaceRequirements(entry.manifest);
      entries.push(entry);
    }
    this.state = buildRegistryState(entries, catalogs);
    return Object.freeze({
      formatVersion: MODE_REGISTRY_FORMAT_VERSION,
      modes: Object.freeze(entries.sort((left, right) => compareText(left.key, right.key)).map((entry) => ({
        id: entry.key,
        key: entry.key,
        rawId: entry.rawId,
        aliases: [...entry.aliases],
        source: clone(entry.source),
        sourceHash: entry.sourceHash,
        manifest: clone(entry.manifest),
      }))),
      rejected: Object.freeze([]),
      sourceCount: this.sources.length,
    });
  }

  async list(options = {}) {
    const discovered = await this.discover(options);
    return discovered.modes;
  }

  async discoverModes(options = {}) { return this.discover(options); }

  async doctor() {
    try {
      const discovered = await this.discover({ refresh: true });
      return Object.freeze({
        ok: true,
        status: "MODE_DOCTOR_PASS",
        mutation: false,
        count: discovered.modes.length,
        errors: [],
      });
    } catch (error) {
      if (error instanceof ModeRegistryError) {
        return Object.freeze({ ok: false, status: "MODE_DOCTOR_FAIL", mutation: false, code: error.code, message: error.message, details: error.details });
      }
      throw error;
    }
  }

  ensureDiscovered() {
    if (!this.state) fail("MODES_NOT_DISCOVERED", "discoverModes must run before resolving a mode");
    return this.state;
  }

  async resolve(id, options = {}) {
    if (!this.state || options.refresh === true) await this.discover(options);
    const state = this.ensureDiscovered();
    if (typeof id !== "string" || id.length === 0) fail("UNKNOWN_MODE", "mode id is required");
    const rawMatches = state.rawIds.get(id) ?? [];
    if (rawMatches.length > 1) fail("AMBIGUOUS_MODE_REFERENCE", `mode id is ambiguous: ${id}`, { candidates: rawMatches });
    const key = state.entries.has(id)
      ? id
      : state.aliases.get(id)
        ?? rawMatches[0]
        ?? null;
    if (!key) fail("UNKNOWN_MODE", `unknown mode: ${id}`);
    const profile = normalizeProfile(options.profile ?? this.profile);
    const visiting = new Set();
    const cache = new Map();
      const resolveEntry = (entryKey, depth = 0) => {
      if (depth > (options.maxDepth ?? this.options.maxDepth ?? 32)) fail("MODE_INHERITANCE_DEPTH", "mode inheritance depth exceeded");
      if (visiting.has(entryKey)) fail("MODE_INHERITANCE_CYCLE", `mode inheritance cycle at ${entryKey}`);
      if (cache.has(entryKey)) return cache.get(entryKey);
      const entry = state.entries.get(entryKey);
      if (!entry) fail("UNKNOWN_MODE_REFERENCE", `unknown mode reference: ${entryKey}`);
      visiting.add(entryKey);
      let effective = null;
      const lineage = [];
      let executionState = null;
      for (const parentRef of entry.manifest.extends) {
        const parentKey = resolveReference(parentRef, entry, state);
        const parentResolved = resolveEntry(parentKey, depth + 1);
        effective = mergeManifests(effective, parentResolved.resolved);
        executionState = effectiveExecutionState(executionState, parentResolved.resolved.executionState);
        for (const parentEntry of parentResolved.lineage) {
          if (!lineage.some((existing) => existing.id === parentEntry.id)) lineage.push(parentEntry);
        }
      }
      effective = mergeManifests(effective, entry.manifest);
      executionState = effectiveExecutionState(executionState, entry.manifest.executionState);
      effective.executionState = executionState;
      lineage.push({ id: entry.key, rawId: entry.rawId, sourceHash: entry.sourceHash, source: entry.source, executionState: entry.manifest.executionState });
      visiting.delete(entryKey);
      const result = Object.freeze({ resolved: effective, lineage: Object.freeze(lineage) });
      cache.set(entryKey, result);
      return result;
    };
    const resolved = resolveEntry(key);
    assertCatalogRequirements(resolved.resolved, state.catalogs);
    assertEgressSurfaceRequirements(resolved.resolved);
    assertProfileCeiling(resolved.resolved, profile);
    const sourceHashes = resolved.lineage.map((entry) => ({ id: entry.id, sourceHash: normalizeSourceHash(entry.sourceHash) }));
    const promptSources = resolved.lineage.map((entry) => {
      const sourceEntry = state.entries.get(entry.id);
      return { id: entry.id, path: sourceEntry.prompt.path, hash: sourceEntry.prompt.hash };
    });
    const promptPayloads = resolved.lineage.map((entry) => {
      const sourceEntry = state.entries.get(entry.id);
      return { id: entry.id, path: sourceEntry.prompt.path, hash: sourceEntry.prompt.hash, content: sourceEntry.prompt.content };
    });
    const snapshot = {
      formatVersion: MODE_REGISTRY_FORMAT_VERSION,
      modeId: key,
      rawModeId: state.entries.get(key).rawId,
      sourceHash: sha256(canonicalJson(sourceHashes)),
      lineage: sourceHashes,
      promptSources,
      resolved: {
        ...resolved.resolved,
        extends: [],
        aliases: union(resolved.resolved.aliases, []),
      },
      profileCeiling: profile
        ? { capabilities: [...profile.capabilities].sort(compareText), packages: [...profile.packages].sort(compareText), policy: clone(profile.policy) }
        : null,
      explain: explainDecisions(resolved.lineage, resolved.resolved),
    };
    const hash = sha256(canonicalJson(snapshot));
    return deepFreeze({
      formatVersion: MODE_REGISTRY_FORMAT_VERSION,
      modeId: key,
      hash,
      sourceHash: snapshot.sourceHash,
      snapshot,
      resolved: snapshot.resolved,
      lineage: snapshot.lineage,
      promptSources,
      promptPayloads,
    });
  }

  async explain(id, options = {}) {
    const resolved = asResolvedSnapshot(options.snapshot) ?? await this.resolve(id, options);
    const snapshot = resolved.snapshot ?? resolved;
    return deepFreeze({
      formatVersion: MODE_REGISTRY_FORMAT_VERSION,
      modeId: resolved.modeId,
      hash: resolved.hash,
      sourceHash: resolved.sourceHash,
      lineage: clone(resolved.lineage),
      capabilities: [...resolved.resolved.requires.profileCapabilities],
      packages: [...resolved.resolved.requires.packages],
      enforcementSurfaces: [...resolved.resolved.requires.enforcementSurfaces],
      tools: clone(resolved.resolved.tools),
      policy: policyProjection(resolved.resolved),
      promptSources: clone(resolved.promptSources),
      decisions: clone(snapshot.explain ?? []),
    });
  }

  async resolveMode(id, options = {}) { return this.resolve(id, options); }
  async explainMode(id, options = {}) { return this.explain(id, options); }

  diff(from, to) {
    if (typeof from === "string") {
      const options = isObject(to) ? to : {};
      return (async () => {
        const target = await this.resolve(from, { ...options, refresh: true });
        const current = options.currentSnapshot ?? null;
        if (!current) {
          return Object.freeze({
            formatVersion: MODE_REGISTRY_FORMAT_VERSION,
            from: null,
            to: { modeId: target.modeId, hash: target.hash, sourceHash: target.sourceHash },
            changes: [],
            hardEnvelopeChanged: true,
            hardChanges: [],
            restartRequired: true,
          });
        }
        return this.diff(current, target);
      })();
    }
    const left = asResolvedSnapshot(from);
    const right = asResolvedSnapshot(to);
    if (!left || !right) fail("INVALID_MODE_SNAPSHOT", "diff requires two resolved mode snapshots");
    const changes = [];
    diffValue(left.resolved, right.resolved, "resolved", changes);
    const hardChanges = changes.filter((change) => HARD_POLICY_PATHS.some((pathName) => change.path === `resolved.${pathName}` || change.path.startsWith(`resolved.${pathName}.`)));
    const output = {
      formatVersion: MODE_REGISTRY_FORMAT_VERSION,
      from: { modeId: left.modeId, hash: left.hash, sourceHash: left.sourceHash },
      to: { modeId: right.modeId, hash: right.hash, sourceHash: right.sourceHash },
      changes,
      hardEnvelopeChanged: hardChanges.length > 0,
      hardChanges,
      restartRequired: hardChanges.length > 0,
    };
    return deepFreeze(output);
  }

  diffModes(from, to) { return this.diff(from, to); }

  async activate(id, options = {}) {
    if (id === null || id === undefined) {
      const session = options.session ?? {};
      if (typeof session.isIdle !== "function") {
        return Object.freeze({ status: "SESSION_NOT_IDLE", code: "SESSION_IDLE_UNAVAILABLE", modeId: null });
      }
      if (typeof session.isIdle === "function" && !(await session.isIdle())) {
        return Object.freeze({ status: "SESSION_NOT_IDLE", code: "SESSION_NOT_IDLE", modeId: null });
      }
      const driver = options.executionStateDriver ?? options.sessionDriver ?? options.driver;
      if (driver && typeof driver.restore === "function") {
        const restored = await driver.restore();
        const restoreStatus = String(restored?.status ?? "").toUpperCase();
        return Object.freeze({ status: restoreStatus === "APPLIED" ? "APPLIED" : "UNAVAILABLE", modeId: null, result: restored });
      }
      return Object.freeze({ status: "RESTART_REQUIRED", code: "EXECUTION_STATE_DRIVER_UNAVAILABLE", modeId: null, launchArgs: options.launchArgs ?? ["--offline", "--no-session"] });
    }
    const target = await this.resolve(id, { ...options, refresh: true });
    const session = options.session ?? {};
    const current = options.currentSnapshot ?? (typeof session.readMode === "function" ? await session.readMode() : null);
    const currentRawId = current?.rawModeId ?? current?.snapshot?.rawModeId;
    const targetRawId = target.snapshot?.rawModeId;
    const sameMode = current?.modeId
      ? current.modeId === target.modeId
      : Boolean(currentRawId && targetRawId && currentRawId === targetRawId);
    if (sameMode && current.sourceHash && current.sourceHash !== target.sourceHash) {
      return Object.freeze({ status: "STALE_MODE_SNAPSHOT", code: "STALE_MODE_SNAPSHOT", modeId: target.modeId, current, target });
    }
    if (current && typeof session.isIdle !== "function") {
      return Object.freeze({ status: "SESSION_NOT_IDLE", code: "SESSION_IDLE_UNAVAILABLE", modeId: target.modeId });
    }
    if (typeof session.isIdle === "function" && !(await session.isIdle())) {
      return Object.freeze({ status: "SESSION_NOT_IDLE", code: "SESSION_NOT_IDLE", modeId: target.modeId });
    }
    const diff = current ? this.diff(current, target) : Object.freeze({ hardEnvelopeChanged: true, hardChanges: [], restartRequired: true });
    if (diff.hardEnvelopeChanged) {
      const driver = options.executionStateDriver ?? options.sessionDriver ?? options.driver;
      if (!driver || typeof driver.probe !== "function" || typeof driver.apply !== "function") {
        return Object.freeze({
          status: "RESTART_REQUIRED",
          code: "EXECUTION_STATE_DRIVER_UNAVAILABLE",
          modeId: target.modeId,
          diff,
          launchArgs: options.launchArgs ?? ["--offline", "--no-session", "--perm", target.resolved.executionState],
        });
      }
      const probe = await driver.probe();
      if (!probe || typeof probe.owner !== "string" || probe.owner.length === 0 || probe.canSwitchAtRuntime !== true) {
        return Object.freeze({ status: "UNAVAILABLE", code: "EXECUTION_STATE_DRIVER_UNAVAILABLE", modeId: target.modeId, diff });
      }
      const applied = await driver.apply(target.snapshot);
      if (applied?.status === "restart-required" || applied?.status === "RESTART_REQUIRED") {
        return Object.freeze({ status: "RESTART_REQUIRED", modeId: target.modeId, diff, launchArgs: applied.launchArgs ?? [] });
      }
      if (applied?.status === "unavailable" || applied?.status === "UNAVAILABLE") {
        return Object.freeze({ status: "UNAVAILABLE", code: "EXECUTION_STATE_DRIVER_UNAVAILABLE", modeId: target.modeId, diff, reason: applied.reason });
      }
    }
    if (typeof session.injectPrompt === "function") await session.injectPrompt(target.promptPayloads ?? target.promptSources, target);
    if (typeof session.setStatus === "function") await session.setStatus({ modeId: target.modeId, hash: target.hash });
    if (typeof session.appendEntry === "function") {
      await session.appendEntry({
        type: "mode_changed",
        modeId: target.modeId,
        hash: target.hash,
        sourceHash: target.sourceHash,
        receipt: createModeReceipt(target),
      });
    }
    return Object.freeze({ status: "APPLIED", modeId: target.modeId, hash: target.hash, sourceHash: target.sourceHash, diff, snapshot: target });
  }

  async activateMode(id, options = {}) { return this.activate(id, options); }

  scaffold(options = {}, maybeOptions = {}) {
    if (typeof options === "string") options = { ...maybeOptions, id: options };
    const id = options.id;
    if (typeof id !== "string" || !ID.test(id)) fail("INVALID_MODE_ID", "scaffold id must be canonical");
    const promptPath = options.promptPath ?? `prompts/${id}.md`;
    const manifest = {
      $schema: "../../schemas/mode-v1.schema.json",
      formatVersion: 1,
      contractStatus: "contract-only",
      id,
      version: "0.1.0",
      displayName: options.displayName ?? id,
      description: options.description ?? "Read-only Mode scaffold; review before activation.",
      category: "labs",
      executionState: "ask",
      extends: [],
      aliases: [],
      requires: { profileCapabilities: [], packages: [], enforcementSurfaces: [] },
      prompt: { file: promptPath },
      tools: { allow: ["find", "grep", "ls", "read"], deny: ["bash", "edit", "web", "write"], required: ["read"] },
      policy: {
        workspace: "read-only",
        egress: { web: "deny", mcp: "deny", provider: "deny", extension: "deny" },
        approval: "deny",
      },
      workflow: { default: "single-agent-safe", fallback: "single-agent-safe" },
      swarm: { allowed: false, defaultRecipe: null },
      completion: { gates: ["review"], requiresStructuredVerdict: true },
      risk: "low",
    };
    validateModeManifest(manifest, { label: "scaffold" });
    const prompt = options.prompt ?? `# ${manifest.displayName}\n\nRead-only scaffold. Define evidence and completion criteria before promotion.\n`;
    const files = [
      { path: "mode.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: promptPath, content: prompt },
    ];
    if (options.write !== true) return deepFreeze({ status: "PLAN_ONLY", mode: manifest, files });
    const root = normalizeRoot(options.destination, "scaffold destination");
    const writer = options.fs ?? this.fs;
    if (typeof writer.mkdir !== "function" || typeof writer.writeFile !== "function") {
      fail("FILESYSTEM_DRIVER_UNAVAILABLE", "scaffold write requires mkdir and writeFile");
    }
    return (async () => {
      await writer.mkdir(root, { recursive: true, mode: 0o700 });
      for (const file of files) {
        const target = pathInside(root, path.join(root, file.path));
        const parent = path.dirname(target);
        if (parent !== root) await writer.mkdir(parent, { recursive: true, mode: 0o700 });
        await writer.writeFile(target, file.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      }
      return deepFreeze({ status: "WRITTEN", mode: manifest, files });
    })();
  }

  scaffoldMode(options = {}) { return this.scaffold(options); }
}

export function createModeRegistry(options = {}) {
  return new ModeRegistry(options);
}

export async function discoverModes(options = {}) {
  const registry = options instanceof ModeRegistry ? options : createModeRegistry(options);
  return registry.discover(options);
}

export async function resolveMode(registryOrOptions, id, options = {}) {
  const registry = registryOrOptions instanceof ModeRegistry
    ? registryOrOptions
    : createModeRegistry(registryOrOptions ?? {});
  return registry.resolve(id, options);
}

export async function explainMode(registryOrResolved, id, options = {}) {
  if (registryOrResolved instanceof ModeRegistry) return registryOrResolved.explain(id, options);
  if (registryOrResolved?.resolved && (registryOrResolved?.hash || registryOrResolved?.modeId)) {
    const registry = options.registry instanceof ModeRegistry ? options.registry : null;
    const snapshotId = id ?? registryOrResolved.modeId;
    if (!registry) return createModeRegistry({}).explain(snapshotId, { snapshot: registryOrResolved });
    return registry.explain(snapshotId, { ...options, snapshot: registryOrResolved });
  }
  const registry = createModeRegistry(registryOrResolved ?? {});
  return registry.explain(id, options);
}

export function diffModes(registryOrFrom, fromOrTo, maybeTo) {
  if (registryOrFrom instanceof ModeRegistry) return registryOrFrom.diff(fromOrTo, maybeTo);
  return createModeRegistry({}).diff(registryOrFrom, fromOrTo);
}

export async function activateMode(registryOrOptions, id, options = {}) {
  const registry = registryOrOptions instanceof ModeRegistry
    ? registryOrOptions
    : createModeRegistry(registryOrOptions ?? {});
  return registry.activate(id, options);
}

export function scaffoldMode(registryOrOptions, options = {}) {
  const registry = registryOrOptions instanceof ModeRegistry
    ? registryOrOptions
    : createModeRegistry(registryOrOptions ?? {});
  return registry.scaffold(options);
}

export { ModeRegistry };
