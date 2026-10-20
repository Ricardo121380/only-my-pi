import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";

test("a real independent account user blocks mutations until its process exits", { timeout: 15000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-process-")));
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "openai", name: "Independent", authType: "api_key" });
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { AccountCatalog } from ${JSON.stringify(new URL("../packages/host/accounts.mjs", import.meta.url).href)};
    const release = await new AccountCatalog(process.argv[1]).beginUse(process.argv[2]);
    process.stdout.write("ready\\n");
    process.stdin.resume();
    process.stdin.once("end", async () => { await release(); process.exit(0); });
  `, root, account.accountId], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(child, "close");
  t.after(async () => { if (child.exitCode === null) child.kill("SIGKILL"); await closed; await fs.rm(root, { recursive: true }); });
  let output = "";
  for await (const chunk of child.stdout) { output += chunk; if (output.includes("ready\n")) break; }
  assert.match(output, /ready/);
  await assert.rejects(accounts.rename(account.accountId, "Must wait"), { code: "ACCOUNT_BUSY" });
  await assert.rejects(accounts.remove(account.accountId), { code: "ACCOUNT_BUSY" });
  child.kill("SIGKILL");
  await closed;
  assert.equal((await accounts.rename(account.accountId, "Recovered")).name, "Recovered");
});

test("crashed owners retain account occupation while a registered real child group survives", { timeout: 15000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-orphan-")));
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "openai", name: "Owner", authType: "api_key" });
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `
    import { spawn } from "node:child_process";
    import { AccountCatalog } from ${JSON.stringify(new URL("../packages/host/accounts.mjs", import.meta.url).href)};
    const reservation = await new AccountCatalog(process.argv[1]).beginUse(process.argv[2]);
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    await reservation.addProcess(child.pid, { group: true });
    process.stdout.write(JSON.stringify({pid:child.pid}) + "\\n");
    setInterval(()=>{},1000);
  `, root, account.accountId], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(parent, "close");
  let childPid;
  t.after(async () => { parent.kill("SIGKILL"); await closed; if (childPid && groupAlive(childPid)) process.kill(-childPid, "SIGKILL"); await fs.rm(root, { recursive: true }); });
  let output = "";
  for await (const chunk of parent.stdout) { output += chunk; if (output.includes("\n")) break; }
  childPid = JSON.parse(output).pid;
  parent.kill("SIGKILL"); await closed;
  assert.ok(await processIdentity(childPid));
  await assert.rejects(accounts.rename(account.accountId, "Premature"), { code: "ACCOUNT_BUSY" });
  process.kill(-childPid, "SIGKILL");
  for (let i = 0; i < 100 && (await processIdentity(childPid) || groupAlive(childPid)); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(await processIdentity(childPid), null); assert.equal(groupAlive(childPid), false);
  assert.equal((await accounts.rename(account.accountId, "Recovered")).name, "Recovered");
});

test("a real independent account change excludes new use and other mutations until confirmed completion", { timeout: 15000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-change-")));
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "openai", name: "Changing", authType: "oauth" });
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { AccountCatalog } from ${JSON.stringify(new URL("../packages/host/accounts.mjs", import.meta.url).href)};
    await new AccountCatalog(process.argv[1]).change(process.argv[2], async () => {
      process.stdout.write("ready\\n"); process.stdin.resume();
      await new Promise(resolve => process.stdin.once("end", resolve));
    });
  `, root, account.accountId], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(child, "close");
  t.after(async () => { child.kill("SIGKILL"); await closed; await fs.rm(root, { recursive: true }); });
  let output = ""; for await (const chunk of child.stdout) { output += chunk; if (output.includes("ready\n")) break; }
  assert.match(output, /ready/);
  await assert.rejects(accounts.beginUse(account.accountId), { code: "ACCOUNT_BUSY" });
  await assert.rejects(accounts.remove(account.accountId), { code: "ACCOUNT_BUSY" });
  child.stdin.end(); assert.equal((await closed)[0], 0);
  const release = await accounts.beginUse(account.accountId); await release();
  await accounts.remove(account.accountId);
});
