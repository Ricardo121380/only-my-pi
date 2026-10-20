import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createImageHost, imageReply, imageCode } from "../../tests/fixtures/image-host.mjs";
const [evidenceDir, controlFile] = process.argv.slice(2);
if (![evidenceDir, controlFile].every(value => typeof value === "string" && path.isAbsolute(value))) throw new Error("absolute evidence directory and private control file required");
await fs.mkdir(evidenceDir, { recursive: true });
const scenarioFile = path.join(evidenceDir, "browser-image-scenario.json"); await fs.writeFile(scenarioFile, JSON.stringify({ mode: "normal" }));
const fixture = await createImageHost({ installedExtensions: true, assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), code: imageCode, response: async ({ req, res, entry, received }) => {
  const { mode } = JSON.parse(await fs.readFile(scenarioFile, "utf8")); entry.scenario = mode;
  await fs.writeFile(path.join(evidenceDir, "browser-image-received.json"), JSON.stringify(received.map(item => ({ requestId: item.requestId, scenario: item.scenario, account: item.key === "Bearer image-fixture-a" ? "synthetic-A" : item.key === "Bearer image-fixture-b" ? "synthetic-B" : "unexpected", url: item.url, body: item.body })), null, 2));
  if (mode === "drop") { req.socket.destroy(); return; }
  const reply = structuredClone(imageReply);
  if (mode === "partialUsage") reply.usage = { prompt_tokens: 12 };
  if (mode === "missingUsage") delete reply.usage;
  if (mode === "empty") reply.choices[0].message.images = [];
  if (mode === "partial") reply.choices[0].finish_reason = "length";
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify(reply));
} });
// Both account objects are synthetic. Credentials and bindings are set through
// the actual page during browser acceptance, never copied from user config.
const accountB = (await fixture.api("/api/accounts", { name: "生图账号 B", providerId: "fixtureimage", authType: "api_key" }, 201)).account;
async function publishControl() {
  const pair = await fetch(fixture.host.origin + "/internal/pair", { method: "POST", headers: { authorization: `Bearer ${fixture.host.controlToken}` } }).then(response => response.json());
  await fs.writeFile(controlFile, JSON.stringify({ pairingUrl: pair.url, origin: fixture.host.origin, projectId: fixture.projectId, accountId: fixture.account.accountId, accountBId: accountB.accountId, imageOrigin: fixture.imageOrigin, project: fixture.project, config: fixture.config, root: fixture.root }), { mode: 0o600 });
}
await publishControl(); console.log(JSON.stringify({ ready: true, origin: fixture.host.origin, project: fixture.project, node: process.version, pi: "1.1.0", scope: "LOCAL_CONTROLLED_SOURCE_HARNESS" }));
let closing = false;
process.on("SIGUSR2", async () => {
  if (closing) return; await fixture.restart(); await publishControl();
  await fs.writeFile(path.join(evidenceDir, "browser-image-restarted-receipt.json"), JSON.stringify(await fixture.receipt(), null, 2));
  console.log(JSON.stringify({ restarted: true, received: fixture.received.length }));
});
process.on("SIGTERM", async () => {
  if (closing) return; closing = true;
  await fs.writeFile(path.join(evidenceDir, "browser-image-final-receipt.json"), JSON.stringify(await fixture.receipt(), null, 2));
  await fixture.close(); await fs.unlink(controlFile); process.exit(0);
});
