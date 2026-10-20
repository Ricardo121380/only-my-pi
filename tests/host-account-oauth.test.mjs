import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { AccountOAuth } from "../packages/host/account-oauth.mjs";

async function fixture(t, timeoutMs = 2000) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-oauth-")));
  await fs.mkdir(path.join(root, "pi/dist"), { recursive: true });
  await fs.writeFile(path.join(root, "pi/package.json"), '{"type":"module"}');
  await fs.writeFile(path.join(root, "pi/dist/index.js"), `export class ModelRuntime {
    static async create() { return new ModelRuntime(); }
    getProviders() { return [{id:"fixture",auth:{oauth:{name:"Fixture OAuth"}}}]; }
    async login(id,type,interaction) {
      interaction.notify({type:"auth_url",url:"https://example.invalid/login?state=fixture"});
      const value=await interaction.prompt({type:"manual_code",message:"Do not expose raw provider messages"});
      if(value==="reject") throw Error("secret must not appear");
      if(value==="sync") {const error=Error("secret");error.name="CredentialSynchronizationError";throw error;}
      if(value!=="accept") throw Error("invalid");
      return {type:"oauth",access:"never-return-this",refresh:"never-return-this"};
    }
  }`);
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "fixture", name: "OAuth", authType: "oauth" });
  const oauth = new AccountOAuth({ stack: { root, nodePath: process.execPath }, configRoot: root, accounts, env: {}, timeoutMs });
  t.after(async () => { await oauth.stop(); await fs.rm(root, { recursive: true }); });
  return { oauth, account, accounts };
}
async function until(oauth, flowId, status) {
  for (let i = 0; i < 200; i++) { const value = oauth.snapshot(flowId); if (value.status === status) return value; await new Promise((r) => setTimeout(r, 10)); }
  throw Error(`Expected ${status}`);
}
test("OAuth subprocess bridge serializes login, binds prompts, strips secrets and releases occupation", async (t) => {
  const { oauth, account, accounts } = await fixture(t);
  assert.deepEqual(await oauth.providers(), [{ providerId: "fixture", name: "Fixture OAuth" }]);
  for (const [answer, expected] of [["accept", "stored"], ["reject", "failed"], ["sync", "stored_sync_failed"]]) {
    const flow = await oauth.start(account.accountId);
    await assert.rejects(oauth.start(account.accountId), { code: "ACCOUNT_AUTH_BUSY" });
    await assert.rejects(accounts.remove(account.accountId), { code: "ACCOUNT_BUSY" });
    const prompt = await until(oauth, flow.flowId, "awaiting_input");
    assert.equal(prompt.event.url, "https://example.invalid/login?state=fixture");
    assert.throws(() => oauth.answer(flow.flowId, "old", answer), { code: "ACCOUNT_AUTH_FLOW_EXPIRED" });
    oauth.answer(flow.flowId, prompt.prompt.promptId, answer);
    const done = await until(oauth, flow.flowId, expected);
    assert.equal(done.prompt, null); assert.equal(done.event, null);
    assert.equal(JSON.stringify(done).includes("never-return"), false);
    await accounts.rename(account.accountId, "Released");
  }
});
test("OAuth cancellation and timeout wait for child exit and reject late answers", async (t) => {
  const { oauth, account, accounts } = await fixture(t, 400);
  const flow = await oauth.start(account.accountId);
  const prompt = await until(oauth, flow.flowId, "awaiting_input");
  assert.equal((await oauth.cancel(flow.flowId)).status, "cancelled");
  assert.equal(oauth.children.size, 0);
  assert.throws(() => oauth.answer(flow.flowId, prompt.prompt.promptId, "accept"), { code: "ACCOUNT_AUTH_FLOW_EXPIRED" });
  await accounts.rename(account.accountId, "Released");
  const next = await oauth.start(account.accountId);
  await until(oauth, next.flowId, "timed_out");
  await oauth.running;
  assert.equal(oauth.children.size, 0);
  await accounts.remove(account.accountId);
});

test("OAuth publishes a terminal result only after the account change reservation has finished", { timeout: 10000 }, async t => {
  const { oauth, account, accounts } = await fixture(t);
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const change = accounts.change.bind(accounts);
  accounts.change = (id, operation) => change(id, async (...args) => { await operation(...args); await gate; });
  const flow = await oauth.start(account.accountId);
  let heldStatus;
  try {
    const prompt = await until(oauth, flow.flowId, "awaiting_input");
    oauth.answer(flow.flowId, prompt.prompt.promptId, "accept");
    for (let i = 0; i < 200 && oauth.children.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(oauth.children.size, 0);
    heldStatus = oauth.snapshot(flow.flowId).status;
    await assert.rejects(accounts.rename(account.accountId, "Too early"), { code: "ACCOUNT_BUSY" });
  } finally { finish(); await oauth.running; }
  assert.notEqual(heldStatus, "stored", "the account transaction was still held");
  assert.equal(oauth.snapshot(flow.flowId).status, "stored");
  await accounts.rename(account.accountId, "Released");
});
