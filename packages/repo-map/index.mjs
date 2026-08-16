import crypto from "node:crypto";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`; }

export class RepoMapError extends Error {
  constructor(message, code = "REPO_MAP_ERROR") { super(`repo-map: ${message}`); this.name = "RepoMapError"; this.code = code; }
}

function normalizeSymbol(symbol) {
  if (!symbol || typeof symbol !== "object" || typeof symbol.path !== "string" || typeof symbol.name !== "string") throw new RepoMapError("symbols require path and name", "INVALID_SYMBOL");
  return { path: symbol.path, name: symbol.name, kind: symbol.kind ?? "symbol", line: Number.isInteger(symbol.line) ? symbol.line : null, score: Number.isFinite(symbol.score) ? symbol.score : 0, references: Number.isInteger(symbol.references) ? symbol.references : 0 };
}

export function rankSymbols(symbols, { maxSymbols = 256 } = {}) {
  if (!Array.isArray(symbols)) throw new RepoMapError("symbols must be an array", "INVALID_SYMBOLS");
  return symbols.map(normalizeSymbol).sort((left, right) => right.score - left.score || right.references - left.references || left.path.localeCompare(right.path) || left.name.localeCompare(right.name)).slice(0, maxSymbols);
}

export class RepoMapAdapter {
  constructor(options = {}) { this.indexer = options.indexer ?? (async () => []); this.maxBytes = options.maxBytes ?? 64 * 1024; }
  async build(input = {}) {
    const symbols = rankSymbols(await this.indexer({ files: [...(input.files ?? [])], rootDir: input.rootDir ?? null }), { maxSymbols: input.maxSymbols ?? 256 });
    const lines = symbols.map((symbol) => `${symbol.path}:${symbol.line ?? "?"} ${symbol.kind} ${symbol.name} refs=${symbol.references}`);
    let text = lines.join("\n");
    let truncated = false;
    while (Buffer.byteLength(text, "utf8") > this.maxBytes && lines.length > 0) { lines.pop(); text = lines.join("\n"); truncated = true; }
    const map = { formatVersion: 1, symbols: symbols.slice(0, lines.length), text, truncated, bytes: Buffer.byteLength(text, "utf8") };
    return Object.freeze({ ...map, digest: digest(map) });
  }
}

export function createRepoMap(options = {}) { return new RepoMapAdapter(options); }
