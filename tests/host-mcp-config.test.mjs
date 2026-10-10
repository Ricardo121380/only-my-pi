import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHost } from "../packages/host/server.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-config-")));
  const configRoot = path.join(root, "config"), project = path.join(root, "project"), assetsRoot = path.join(root, "assets");
  for (const dir of [configRoot, project, assetsRoot]) await fs.mkdir(dir);
  await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>MCP</title>");
  const host = await startHost({ configRoot, assetsRoot, stack: { root, stackId: "fixture" }, modelsProvider: () => [] });
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const paired = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  const cookie = paired.headers.get("set-cookie").split(";")[0];
  const request = async (input, expected = 200) => {
    const response = await fetch(host.origin + "/api/mcp", { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-mcp-protocol": "1" }, body: JSON.stringify(input) });
    assert.equal(response.status, expected); return response.json();
  };
  return { root, configRoot, project, host, request };
}
const baseServer = { name: "local", transport: "stdio", enabled: false, command: process.execPath, args: [], codePaths: [], env: {}, credentialRefs: {}, tools: [{ name: "read_file", effect: "read", pathArgument: "path", paths: ["README.md"] }] };

test("public MCP import previews differences, persists disabled OMP configuration and preserves the raw file", async (t) => {
  const f = await fixture(t);
  const source = JSON.stringify({ mcpServers: { local: { command: process.execPath, args: ["-e", "require('fs').writeFileSync('must-not-start','bad')"], env: {} } } });
  const raw = path.join(f.configRoot, "mcp.json"); await fs.writeFile(raw, source);
  const preview = await f.request({ type: "previewImport", source });
  assert.equal(preview.servers[0].enabled, false);
  assert.equal(preview.servers[0].name, "local");
  assert.equal(preview.revision, 0);
  await assert.rejects(fs.access(path.join(f.project, "must-not-start")), { code: "ENOENT" });
  const saved = await f.request({ type: "import", source, revision: 0, digest: preview.digest });
  assert.equal(saved.revision, 1); assert.equal(saved.servers[0].enabled, false);
  assert.equal(await fs.readFile(raw, "utf8"), source);
  assert.equal((await f.request({ type: "list" })).revision, 1);
  await f.request({ type: "import", source, revision: 0, digest: preview.digest }, 409);
  await assert.rejects(fs.access(path.join(f.project, "must-not-start")), { code: "ENOENT" });
});

test("project overrides expose their origin and project-only revocation leaves other projects enabled", async (t) => {
  const f = await fixture(t);
  const { McpCatalog } = await import("../packages/mcp/catalog.mjs");
  const catalog = new McpCatalog(f.configRoot);
  await f.request({ type: "save", revision: 0, server: { ...baseServer, enabled: true } });
  const other = path.join(f.root, "other"); await fs.mkdir(other);
  const prior = await catalog.snapshot(f.project), unrelated = await catalog.snapshot(other);
  await catalog.action({ type: "enable", revision: 1, name: "local", enabled: false }, f.project);
  assert.equal(await catalog.current(prior.servers[0]), false);
  assert.equal(await catalog.current(unrelated.servers[0]), true);
  assert.equal((await catalog.snapshot(f.project)).servers[0].source, "project");
  assert.equal((await catalog.snapshot(other)).servers[0].enabled, true);
});

test("public admission rejects mutation tools, unbounded scopes, dynamic secrets and inherited environment", async (t) => {
  const f = await fixture(t);
  for (const change of [{ tools: [{ ...baseServer.tools[0], effect: "write" }] }, { tools: [{ ...baseServer.tools[0], paths: [".."] }] }, { env: { AMBIENT_SECRET: "x" } }, { env: { CONFIG: "${SECRET}" } }, { env: { CONFIG: "!cat ~/.secret" } }, { inheritEnv: true }, { cwd: "../other" }]) {
    await f.request({ type: "save", revision: 0, server: { ...baseServer, ...change } }, 400);
    assert.equal((await f.request({ type: "list" })).revision, 0);
  }
});

test("credential references are private, project/target bound and explicitly revocable", async (t) => {
  const f = await fixture(t), { McpCatalog } = await import("../packages/mcp/catalog.mjs"), catalog = new McpCatalog(f.configRoot);
  await catalog.action({ type: "save", revision: 0, server: baseServer }, f.project);
  const saved = await catalog.action({ type: "credential", revision: 1, name: "local", envName: "MCP_TOKEN", value: "synthetic-mcp-credential" }, f.project);
  assert.equal(JSON.stringify(saved).includes("synthetic-mcp-credential"), false);
  const server = saved.servers[0], file = path.join(f.configRoot, "only-my-pi/mcp/credentials", `${server.credentialRefs.MCP_TOKEN}.json`);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await assert.rejects(catalog.credentials(server, path.join(f.root, "other")), { code: "MCP_CREDENTIAL_BINDING_CHANGED" });
  await assert.rejects(catalog.credentials({ ...server, targetDigest: "different" }, f.project), { code: "MCP_CREDENTIAL_BINDING_CHANGED" });
  await catalog.action({ type: "revokeCredential", revision: 2, name: "local", envName: "MCP_TOKEN" }, f.project);
  await assert.rejects(catalog.credentials(server, f.project), { code: "MCP_CREDENTIAL_BINDING_CHANGED" });
});
