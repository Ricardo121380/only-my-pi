import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import { atomicWriteJson, readJsonObject, ensureConfigDirectory, withConfigLock, assertSafeContainedPath } from "../config-runtime/index.mjs";
import { hostError, CLI_ACCOUNT_ID } from "./contracts.mjs";

const fields = {
  providerId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" },
  name: { type: "string", minLength: 1, maxLength: 128, pattern: "^[^\\u0000-\\u001f\\u007f]+$" },
  authType: { enum: ["api_key", "oauth"] },
};
const ajv = new Ajv({ strict: true });
const validateInput = ajv.compile({ type: "object", additionalProperties: false, required: Object.keys(fields), properties: fields });
const validateProvider = ajv.compile({ type: "object", additionalProperties: false, required: ["baseUrl", "api", "models"], properties: {
  baseUrl: { type: "string", maxLength: 2048 }, api: { enum: ["openai-completions", "openai-responses", "anthropic-messages"] },
  models: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "name", "contextWindow", "maxTokens"], properties: {
    id: { type: "string", minLength: 1, maxLength: 256 }, name: { type: "string", minLength: 1, maxLength: 256 },
    contextWindow: { type: "integer", minimum: 1, maximum: 10000000 }, maxTokens: { type: "integer", minimum: 1, maximum: 1000000 }, reasoning: { type: "boolean" },
  } } },
} });
const validateStore = ajv.compile({
  type: "object", additionalProperties: false, required: ["version", "accounts"],
  properties: {
    version: { const: 1 },
    accounts: { type: "array", maxItems: 1000, items: {
      type: "object", additionalProperties: false,
      required: ["accountId", ...Object.keys(fields)],
      properties: { ...fields, accountId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } },
    } },
  },
});

// Metadata only. Pi owns credentials; this catalog must never accept secrets.
export class AccountCatalog {
  constructor(configRoot) {
    this.configRoot = path.resolve(configRoot);
    this.directory = "only-my-pi/host/accounts";
    this.file = path.join(this.configRoot, this.directory, "catalog.json");
    this.users = new Map(); this.changing = new Set();
  }
  // One instance is shared by the singleton Host's task and account services.
  beginUse(accountId) {
    if (this.changing.has(accountId)) throw hostError("ACCOUNT_BUSY", 409);
    this.users.set(accountId, (this.users.get(accountId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = this.users.get(accountId) - 1;
      if (remaining) this.users.set(accountId, remaining); else this.users.delete(accountId);
    };
  }
  async change(accountId, operation) {
    if (accountId === CLI_ACCOUNT_ID) throw hostError("ACCOUNT_READ_ONLY", 403);
    if (this.changing.has(accountId) || this.users.has(accountId)) throw hostError("ACCOUNT_BUSY", 409);
    this.changing.add(accountId);
    try { return await operation(await this.get(accountId)); }
    finally { this.changing.delete(accountId); }
  }
  async list() {
    let value;
    try { value = await readJsonObject(this.configRoot, this.file, { allowMissing: true }); }
    catch { throw hostError("ACCOUNT_STORE_UNREADABLE", 500); }
    if (value === null) return [];
    if (!validateStore(value) || new Set(value.accounts.map((a) => a.accountId)).size !== value.accounts.length) {
      throw hostError("ACCOUNT_STORE_INVALID", 500);
    }
    return value.accounts;
  }
  async get(accountId) {
    const account = (await this.list()).find((item) => item.accountId === accountId);
    if (!account) throw hostError("ACCOUNT_NOT_FOUND", 404);
    return account;
  }
  // Internal runtime input, never an HTTP response or a client-supplied path.
  async runtimePaths(accountId) {
    const account = await this.get(accountId);
    const directory = await ensureConfigDirectory(this.configRoot, `${this.directory}/${account.accountId}`);
    const paths = { authPath: path.join(directory, "auth.json"), modelsPath: path.join(directory, "models.json"), modelsStorePath: path.join(directory, "models-store.json") };
    for (const file of Object.values(paths)) await assertSafeContainedPath(this.configRoot, file, { leafType: "file" });
    return paths;
  }
  async create(input) {
    if (!validateInput(input) || !input.name.trim()) throw hostError("ACCOUNT_INPUT_INVALID");
    const account = { accountId: randomUUID(), providerId: input.providerId, name: input.name.trim(), authType: input.authType };
    await ensureConfigDirectory(this.configRoot, this.directory);
    return withConfigLock(this.configRoot, { lockDirectory: path.join(this.configRoot, this.directory, "catalog.lock") }, async () => {
      const accounts = await this.list();
      if (accounts.length >= 1000) throw hostError("ACCOUNT_LIMIT", 409);
      await atomicWriteJson(this.configRoot, this.file, { version: 1, accounts: [...accounts, account] });
      return account;
    });
  }
  async configure(accountId, config) {
    if (!validateProvider(config)) throw hostError("ACCOUNT_PROVIDER_INVALID");
    let url;
    try { url = new URL(config.baseUrl); } catch { throw hostError("ACCOUNT_PROVIDER_INVALID"); }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw hostError("ACCOUNT_PROVIDER_INVALID");
    if (new Set(config.models.map((m) => m.id)).size !== config.models.length) throw hostError("ACCOUNT_PROVIDER_INVALID");
    return this.change(accountId, async (account) => {
      const paths = await this.runtimePaths(accountId);
      await atomicWriteJson(this.configRoot, paths.modelsPath, { providers: { [account.providerId]: structuredClone(config) } });
      return { status: "configured" };
    });
  }
  async rename(accountId, name) {
    if (!validateInput({ providerId: "valid", authType: "api_key", name }) || !name.trim()) throw hostError("ACCOUNT_INPUT_INVALID");
    return this.change(accountId, async () => withConfigLock(this.configRoot, { lockDirectory: path.join(this.configRoot, this.directory, "catalog.lock") }, async () => {
      const accounts = await this.list(), account = accounts.find((a) => a.accountId === accountId);
      if (!account) throw hostError("ACCOUNT_NOT_FOUND", 404);
      account.name = name.trim();
      await atomicWriteJson(this.configRoot, this.file, { version: 1, accounts }); return account;
    }));
  }
  async remove(accountId) {
    return this.change(accountId, async () => withConfigLock(this.configRoot, { lockDirectory: path.join(this.configRoot, this.directory, "catalog.lock") }, async () => {
      const accounts = await this.list();
      const directory = path.dirname((await this.runtimePaths(accountId)).authPath);
      await fs.rm(directory, { recursive: true });
      await atomicWriteJson(this.configRoot, this.file, { version: 1, accounts: accounts.filter((a) => a.accountId !== accountId) });
      return { status: "removed" };
    }));
  }
}
