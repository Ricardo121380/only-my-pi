import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";

const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const HEX = /^#[0-9a-fA-F]{6}$/u;
const SEMANTIC_TOKENS = Object.freeze([
  "primary", "accent", "text", "background", "surface", "border", "success",
  "warning", "error", "diffAdded", "diffRemoved", "roleUser", "shellMode",
]);
const PI_REQUIRED_COLORS = Object.freeze([
  "accent", "border", "borderAccent", "borderMuted", "success", "error",
  "warning", "muted", "dim", "text", "thinkingText", "selectedBg",
  "userMessageBg", "userMessageText", "customMessageBg", "customMessageText",
  "customMessageLabel", "toolPendingBg", "toolSuccessBg", "toolErrorBg",
  "toolTitle", "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode",
  "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr",
  "mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator",
  "syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow",
  "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode",
]);
const TOKEN_TO_VAR = Object.freeze({ diffAdded: "success", diffRemoved: "error" });

export class ThemeServiceError extends Error {
  constructor(message, code = "THEME_SERVICE_ERROR", details = {}) {
    super(`theme-service: ${message}`);
    this.name = "ThemeServiceError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) { throw new ThemeServiceError(message, code, details); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`; }
function assertRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.parse(value).root === path.resolve(value)) fail("rootDir must be an explicit non-filesystem-root absolute path", "INVALID_THEME_ROOT");
  return path.resolve(value);
}
function contained(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\0")) fail("theme path must be repository-relative", "THEME_PATH_ESCAPE");
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail("theme path escapes repository", "THEME_PATH_ESCAPE");
  return target;
}
function parseHex(value) {
  if (!HEX.test(value ?? "")) fail(`invalid semantic color: ${String(value)}`, "INVALID_THEME_COLOR");
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}
function luminance(value) {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}
export function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}
function thresholdFor(check, contract) {
  return /^(?:text|role-user)(?:-|$)/u.test(check.name) ? contract.contrast.minTextRatio : contract.contrast.minUiRatio;
}

export function validateThemeContract(contract, piTheme) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (!object(contract)) return { valid: false, errors: [{ code: "INVALID_THEME_CONTRACT", message: "contract must be an object" }] };
  if (contract.formatVersion !== 1 || contract.contractStatus !== "runtime-ready") add("UNSUPPORTED_THEME_CONTRACT", "theme contract must be runtime-ready v1");
  if (!ID.test(contract.id ?? "")) add("INVALID_THEME_ID", "theme id must be canonical");
  if (!/^themes\/[A-Za-z0-9._-]+\.json$/u.test(contract.themePath ?? "")) add("THEME_PATH_ESCAPE", "themePath must stay under themes/");
  if (contract.mode !== "dark" && contract.mode !== "light") add("INVALID_THEME_MODE", "theme mode must be dark or light");
  for (const token of SEMANTIC_TOKENS) if (!HEX.test(contract.tokens?.[token] ?? "")) add("MISSING_THEME_TOKEN", `semantic token ${token} is missing or invalid`);
  if (!Array.isArray(contract.contrast?.checks) || contract.contrast.checks.length < 2) add("MISSING_CONTRAST_CHECK", "at least two contrast checks are required");
  for (const check of contract.contrast?.checks ?? []) {
    try {
      const actual = contrastRatio(check.foreground, check.background);
      const expectedPass = actual >= thresholdFor(check, contract);
      if (Math.abs(actual - check.ratio) > 0.02) add("CONTRAST_RECEIPT_DRIFT", `contrast ratio drift for ${check.name}`);
      if (check.pass !== expectedPass || !expectedPass) add("CONTRAST_CHECK_FAILED", `contrast check failed for ${check.name}`);
    } catch (error) {
      add(error.code ?? "INVALID_THEME_COLOR", error.message);
    }
  }
  if (piTheme !== undefined) {
    if (!object(piTheme) || piTheme.name !== contract.piThemeName) add("PI_THEME_NAME_MISMATCH", "Pi theme name does not match contract");
    for (const color of PI_REQUIRED_COLORS) if (!Object.hasOwn(piTheme?.colors ?? {}, color)) add("PI_THEME_COLOR_MISSING", `Pi theme color ${color} is missing`);
    for (const token of SEMANTIC_TOKENS) {
      const variable = TOKEN_TO_VAR[token] ?? token;
      if (piTheme?.vars?.[variable] !== contract.tokens?.[token]) add("PI_THEME_TOKEN_DRIFT", `Pi variable ${variable} differs from semantic token ${token}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizeFs(input) {
  const fs = input ?? fsPromises;
  for (const method of ["readdir", "readFile", "lstat", "realpath"]) if (typeof fs[method] !== "function") fail(`filesystem driver lacks ${method}`, "THEME_FILESYSTEM_UNAVAILABLE");
  return fs;
}
async function checkedDirectory(fs, target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("theme contract root must be a real directory", "THEME_PATH_ESCAPE");
}
async function checkedFile(fs, root, target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("theme resource must be a regular non-symlink file", "THEME_PATH_ESCAPE");
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail("theme resource escapes repository", "THEME_PATH_ESCAPE");
}

export class ThemeRegistry {
  constructor({ rootDir, contractRoot, fs } = {}) {
    this.rootDir = assertRoot(rootDir);
    this.contractRoot = path.resolve(contractRoot ?? path.join(this.rootDir, "contracts", "themes"));
    const rel = path.relative(this.rootDir, this.contractRoot);
    if (rel.startsWith("..") || path.isAbsolute(rel)) fail("contract root escapes repository", "THEME_PATH_ESCAPE");
    this.fs = normalizeFs(fs);
    this.entries = null;
  }
  async discover() {
    await checkedDirectory(this.fs, this.contractRoot);
    const entries = [];
    for (const item of (await this.fs.readdir(this.contractRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (item.isSymbolicLink()) fail("theme contract symlinks are forbidden", "THEME_PATH_ESCAPE");
      if (!item.isFile() || !item.name.endsWith(".json")) continue;
      const contractPath = path.join(this.contractRoot, item.name);
      await checkedFile(this.fs, this.rootDir, contractPath);
      const contract = JSON.parse(await this.fs.readFile(contractPath, "utf8"));
      const themePath = contained(this.rootDir, contract.themePath);
      await checkedFile(this.fs, this.rootDir, themePath);
      const piTheme = JSON.parse(await this.fs.readFile(themePath, "utf8"));
      const validation = validateThemeContract(contract, piTheme);
      if (!validation.valid) fail(`theme ${contract.id ?? item.name} failed validation`, "INVALID_THEME_CONTRACT", { errors: validation.errors });
      entries.push(Object.freeze({
        id: contract.id,
        contract: Object.freeze(clone(contract)),
        piTheme: Object.freeze(clone(piTheme)),
        sourceHash: digest({ contract, piTheme }),
      }));
    }
    if (entries.length === 0) fail("no theme contracts were found", "THEME_REGISTRY_EMPTY");
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) fail("duplicate theme id", "DUPLICATE_THEME_ID");
    this.entries = new Map(entries.map((entry) => [entry.id, entry]));
    return entries;
  }
  async list() { return this.entries ? [...this.entries.values()] : this.discover(); }
  async resolve(themeId) {
    if (!this.entries) await this.discover();
    const entry = this.entries.get(themeId);
    if (!entry) fail(`unknown theme: ${themeId}`, "UNKNOWN_THEME");
    return entry;
  }
  async doctor() {
    try {
      const entries = await this.discover();
      return { ok: true, status: "THEME_DOCTOR_PASS", mutation: false, count: entries.length, errors: [] };
    } catch (error) {
      return { ok: false, status: "THEME_DOCTOR_FAIL", mutation: false, code: error.code ?? "THEME_DOCTOR_FAIL", errors: clone(error.errors ?? []) };
    }
  }
}

function ansiColor(hex, text) {
  const [red, green, blue] = parseHex(hex);
  return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[0m`;
}
function preview(entry) {
  const labels = ["primary", "accent", "success", "warning", "error", "diffAdded", "diffRemoved", "roleUser", "shellMode"];
  const ansi = labels.map((token) => ansiColor(entry.contract.tokens[token], `${token}=██`)).join(" ");
  return {
    themeId: entry.id,
    piThemeName: entry.contract.piThemeName,
    mode: entry.contract.mode,
    tokens: clone(entry.contract.tokens),
    contrast: clone(entry.contract.contrast),
    ansi,
    sourceHash: entry.sourceHash,
  };
}
function normalizeApplyResult(value) {
  if (value === true || value === undefined) return { success: true };
  if (value === false) return { success: false, error: "theme driver rejected the request" };
  if (object(value) && typeof value.success === "boolean") return value;
  return { success: false, error: "theme driver returned an invalid result" };
}

export class ThemeControlService {
  constructor({ rootDir, registry, themeDriver } = {}) {
    this.rootDir = assertRoot(rootDir);
    this.registry = registry ?? new ThemeRegistry({ rootDir: this.rootDir });
    this.themeDriver = themeDriver ?? null;
  }
  async #dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") {
      const entries = await this.registry.list();
      return { ok: true, status: "THEME_LIST", mutation: false, count: entries.length, themes: entries.map((entry) => ({ id: entry.id, displayName: entry.contract.displayName, mode: entry.contract.mode, piThemeName: entry.contract.piThemeName, sourceHash: entry.sourceHash })) };
    }
    if (subcommand === "doctor") return this.registry.doctor();
    if (subcommand === "show") {
      const entry = await this.registry.resolve(options.themeId);
      return { ok: true, status: "THEME_SHOW", mutation: false, theme: clone(entry.contract), sourceHash: entry.sourceHash };
    }
    if (subcommand === "preview") {
      const entry = await this.registry.resolve(options.themeId);
      return { ok: true, status: "THEME_PREVIEW", mutation: false, preview: preview(entry) };
    }
    if (subcommand === "use" || subcommand === "reset") {
      const entry = subcommand === "use" ? await this.registry.resolve(options.themeId) : null;
      const target = entry?.contract.piThemeName ?? "dark";
      if (options.apply !== true) return { ok: true, status: "THEME_PLAN", mutation: false, action: subcommand, themeId: entry?.id ?? null, piThemeName: target, reversible: true };
      const driver = options.themeDriver ?? this.themeDriver;
      if (!driver || typeof driver.setTheme !== "function") return { ok: false, status: "THEME_APPLY_UNAVAILABLE", mutation: false, code: "THEME_DRIVER_UNAVAILABLE", next: "run /omp theme use inside an interactive Pi TUI session" };
      let applied;
      try { applied = normalizeApplyResult(await driver.setTheme(target)); }
      catch { applied = { success: false, error: "theme driver failed" }; }
      if (!applied.success) return { ok: false, status: "THEME_APPLY_FAILED", mutation: false, code: "THEME_DRIVER_REJECTED", message: String(applied.error ?? "theme driver rejected the request").replace(/[\r\n]/gu, " ").slice(0, 256) };
      return { ok: true, status: subcommand === "use" ? "THEME_APPLIED" : "THEME_DISABLED", mutation: true, themeId: entry?.id ?? null, piThemeName: target, safeDisable: subcommand === "reset" };
    }
    return { ok: false, status: "THEME_COMMAND_INVALID", mutation: false, code: "INVALID_THEME_COMMAND" };
  }

  async dispatch(options = {}) {
    try {
      return await this.#dispatch(options);
    } catch (error) {
      if (error?.code === "UNKNOWN_THEME") {
        return {
          ok: false,
          status: "THEME_NOT_FOUND",
          mutation: false,
          code: error.code,
          message: String(error.message ?? "unknown theme").replace(/[\r\n]/gu, " ").slice(0, 256),
        };
      }
      return {
        ok: false,
        status: "THEME_SERVICE_UNAVAILABLE",
        mutation: false,
        code: error?.code ?? "THEME_SERVICE_UNAVAILABLE",
        message: String(error?.message ?? "theme service is unavailable").replace(/[\r\n]/gu, " ").slice(0, 256),
      };
    }
  }
}

export function createThemeRegistry(options = {}) { return new ThemeRegistry(options); }
export function createThemeControlService(options = {}) { return new ThemeControlService(options); }
export { SEMANTIC_TOKENS };
