import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpCatalog } from "../packages/mcp/catalog.mjs";
import { processIdentity } from "../packages/host/ownership.mjs";

test("bounded OAuth status history preserves a live admission and never evicts an unknown owner to admit another login", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-oauth-owners-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const catalog = new McpCatalog(root), projectPath = root;
  const active = { flowId: "live", name: "live", projectPath, ownerPid: process.pid, ownerIdentity: await processIdentity(),
    status: "waiting", updatedAt: "2000-01-01T00:00:00.000Z", events: [] };
  await catalog.claimOAuthFlow(active);
  const legacy = { ...active, flowId: "legacy", name: "legacy" }; delete legacy.ownerPid; delete legacy.ownerIdentity;
  await catalog.claimOAuthFlow(legacy);
  for (let i = 0; i < 32; i++) {
    const flow = { ...active, flowId: `done-${i}`, name: `done-${i}`, updatedAt: new Date().toISOString() };
    await catalog.claimOAuthFlow(flow); await catalog.saveOAuthFlow({ ...flow, status: "cancelled" });
  }
  const flows = await catalog.oauthFlows();
  assert.equal(Object.keys(flows).length, 32);
  assert.equal(flows[catalog.key(projectPath, "live")]?.flowId, "live");
  assert.equal(flows[catalog.key(projectPath, "legacy")]?.status, "waiting");
  for (const flow of [active, legacy]) await assert.rejects(catalog.claimOAuthFlow({ ...flow, flowId: "replacement" }), { code: "MCP_OAUTH_BUSY" });
  await assert.rejects(catalog.saveOAuthFlow({ ...active, flowId: "obsolete", status: "cancelled" }), { code: "MCP_OAUTH_FLOW_EXPIRED" });
  assert.equal((await catalog.oauthFlows())[catalog.key(projectPath, "live")].status, "waiting");
});
