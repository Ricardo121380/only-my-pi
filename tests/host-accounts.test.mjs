import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const { fauxProvider, fauxAssistantMessage } = await import(new URL("../node_modules/@earendil-works/pi-ai/dist/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

test("public ModelRuntime isolates same-provider stored accounts, serialized refresh and sync failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-probe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let refreshes = 0;
  let failSync = false;
  const faux = fauxProvider({ provider: "same-provider" });
  const provider = { ...faux.provider, auth: {
    apiKey: { name: "Fixture key", login: async (interaction) => ({ type: "api_key", key: await interaction.prompt({ type: "secret", message: "Fixture" }) }),
      resolve: async ({ credential }) => { if (failSync) throw new Error("fixture catalog unavailable"); return credential?.key ? { auth: { apiKey: credential.key } } : undefined; } },
    oauth: { name: "Fixture OAuth", login: async () => ({ type: "oauth", refresh: "fixture-refresh", access: "expired", expires: 1 }),
      refresh: async (credential) => { refreshes++; await new Promise((resolve) => setTimeout(resolve, 20)); return { ...credential, access: "refreshed-fixture", expires: Date.now() + 3600000 }; }, toAuth: async (credential) => ({ apiKey: credential.access }) },
  } };
  async function account(id) {
    const directory = path.join(root, id); await fs.mkdir(directory);
    const runtime = await ModelRuntime.create({ authPath: path.join(directory, "auth.json"), modelsPath: null, allowModelNetwork: false });
    runtime.registerNativeProvider(provider); await runtime.refresh({ allowNetwork: false }); return runtime;
  }
  const a = await account("a"); const b = await account("b");
  const interaction = (key) => ({ prompt: async () => key, notify() {} });
  await a.login(provider.id, "api_key", interaction("fixture-a"));
  await b.login(provider.id, "api_key", interaction("fixture-b"));
  assert.equal((await a.getAuth(provider.id)).auth.apiKey, "fixture-a");
  assert.equal((await b.getAuth(provider.id)).auth.apiKey, "fixture-b");
  const requestKeys = [];
  faux.setResponses([(_context, options) => { requestKeys.push(options.apiKey); return fauxAssistantMessage("a"); }, (_context, options) => { requestKeys.push(options.apiKey); return fauxAssistantMessage("b"); }]);
  const context = { messages: [{ role: "user", content: "fixture request", timestamp: Date.now() }] };
  await a.completeSimple(faux.getModel(), context);
  await b.completeSimple(faux.getModel(), context);
  assert.deepEqual(requestKeys, ["fixture-a", "fixture-b"]);
  await b.logout(provider.id);
  // Explicit store selection + credential-only provider policy cannot use default/env credentials.
  assert.equal(await b.getAuth(provider.id, { env: { OPENAI_API_KEY: "ambient-fixture" } }), undefined);
  await a.login(provider.id, "oauth", interaction("unused"));
  refreshes = 0;
  // Re-seed an expired *fixture* credential; never reads or copies user tokens.
  await fs.writeFile(path.join(root, "a/auth.json"), JSON.stringify({ [provider.id]: { type: "oauth", refresh: "fixture-refresh", access: "expired", expires: 1 } }));
  const auth = await Promise.all(Array.from({ length: 8 }, () => a.getAuth(provider.id)));
  assert.equal(refreshes, 1);
  assert.ok(auth.every((entry) => entry.auth.apiKey === "refreshed-fixture"));
  failSync = true;
  await assert.rejects(b.login(provider.id, "api_key", interaction("stored-before-sync")), (error) => error.name === "CredentialSynchronizationError");
  const persisted = JSON.parse(await fs.readFile(path.join(root, "b/auth.json"), "utf8"));
  assert.equal(persisted[provider.id].key, "stored-before-sync");
});
