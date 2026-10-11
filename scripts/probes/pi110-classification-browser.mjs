import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClassificationHost, classificationReply, classificationCode, classificationContext } from "../../tests/fixtures/classification-host.mjs";
const [evidenceDir, controlFile] = process.argv.slice(2);
if (![evidenceDir, controlFile].every(value => typeof value === "string" && path.isAbsolute(value))) throw new Error("absolute evidence directory and private control file required");
await fs.mkdir(evidenceDir, { recursive: true });
const scenarioFile = path.join(evidenceDir, "browser-scenario.json");
await fs.writeFile(scenarioFile, JSON.stringify({ mode: "normal" }));
const fixture = await createClassificationHost({ installedExtensions: true, assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), code: body => {
  if (JSON.stringify(body.messages).includes("并发")) return `const model = await models.getModelOfType("classifier","fixtureclass","sentiment"); text(await Promise.allSettled([models.classify(model,${JSON.stringify(classificationContext)}),models.classify(model,${JSON.stringify(classificationContext)})]));`;
  return classificationCode;
}, response: async ({ req, res, entry, received }) => {
  const { mode } = JSON.parse(await fs.readFile(scenarioFile, "utf8")); entry.scenario = mode;
  await fs.writeFile(path.join(evidenceDir, "browser-received.json"), JSON.stringify(received.map(item => ({ requestId: item.requestId, scenario: item.scenario, account: item.key === "Bearer class-fixture-a" ? "synthetic-A" : "unexpected", url: item.url, body: item.body })), null, 2));
  if (mode === "drop") { req.socket.destroy(); return; }
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify(mode === "missingUsage" ? { answers: classificationReply.answers } : mode === "partialUsage" ? { ...classificationReply, usage: { input_tokens: 12 } } : classificationReply));
} });
async function publishControl() {
  const pair = await fetch(fixture.host.origin + "/internal/pair", { method: "POST", headers: { authorization: `Bearer ${fixture.host.controlToken}` } }).then(response => response.json());
  await fs.writeFile(controlFile, JSON.stringify({ pairingUrl: pair.url, origin: fixture.host.origin, projectId: fixture.projectId, accountId: fixture.account.accountId, classifierOrigin: fixture.classifierOrigin, project: fixture.project }), { mode: 0o600 });
}
await publishControl();
console.log(JSON.stringify({ ready: true, origin: fixture.host.origin, project: fixture.project, node: process.version, pi: "1.1.0", scope: "LOCAL_CONTROLLED_SOURCE_HARNESS" }));
let closing = false;
process.on("SIGUSR2", async () => {
  if (closing) return;
  await fixture.restart(); await publishControl();
  await fs.writeFile(path.join(evidenceDir, "browser-restarted-receipt.json"), JSON.stringify(await fixture.receipt(), null, 2));
  console.log(JSON.stringify({ restarted: true, received: fixture.received.length }));
});
process.on("SIGTERM", async () => {
  if (closing) return; closing = true;
  await fs.writeFile(path.join(evidenceDir, "browser-final-receipt.json"), JSON.stringify(await fixture.receipt(), null, 2));
  await fixture.close(); await fs.unlink(controlFile); process.exit(0);
});
