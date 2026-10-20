import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";

test("copied CLI fixtures omit unmeasured coverage while checkout workers retain real function coverage", { timeout: 30000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-fixture-coverage-")));
  let child, closed, identity;
  t.after(async () => {
    if (child) {
      if (identity && await processIdentity(child.pid) === identity) process.kill(-child.pid, "SIGKILL");
      await closed;
      for (let i = 0; i < 50 && groupAlive(child.pid); i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(groupAlive(child.pid), false, "coverage probes must exit before fixture cleanup");
    }
    await fs.rm(root, { recursive: true });
  });
  const f = await createPi110SourceCli(path.join(root, "runtime"), { baseUrl: "http://127.0.0.1:1/v1" });
  const profiles = path.join(root, "profiles"); await fs.mkdir(profiles);
  const contractUrl = new URL("../packages/host/contracts.mjs", import.meta.url).href;
  // A separate Node parent supplies real automatic coverage propagation without
  // changing this test worker's own coverage environment or recorded counters.
  const probe = `import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
let raw = ""; for await (const bytes of process.stdin) raw += bytes;
const input = JSON.parse(raw), execFile = promisify(callback);
const cli = await execFile(process.execPath, [input.cli, "account", "help"], { cwd: input.project, env: input.cliEnv });
if (!JSON.parse(cli.stdout).usage.includes("omp account login")) throw Error("CLI_HELP_FAILED");
const script = "import { hostError } from " + JSON.stringify(input.contractUrl) + "; if (hostError('COVERAGE_PROBE').code !== 'COVERAGE_PROBE') throw Error('CHECKOUT_PROBE_FAILED');";
await execFile(process.execPath, ["--input-type=module", "-e", script], { env: input.env });`;
  child = spawn(process.execPath, ["--input-type=module", "-e", probe], {
    env: { ...process.env, NODE_V8_COVERAGE: profiles }, detached: true, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = ""; child.stdout.resume(); child.stderr.on("data", bytes => { stderr += bytes; });
  closed = once(child, "close"); identity = await processIdentity(child.pid);
  child.stdin.end(JSON.stringify({ cli: f.cli, project: f.project, cliEnv: f.cliEnv ?? f.env, env: f.env, contractUrl }));
  const [code, signal] = await closed; assert.equal(signal, null); assert.equal(code, 0, stderr);
  const scripts = (await Promise.all((await fs.readdir(profiles)).filter(name => name.endsWith(".json"))
    .map(async name => JSON.parse(await fs.readFile(path.join(profiles, name), "utf8")).result))).flat();
  assert.ok(scripts.some(script => script.url === contractUrl && script.functions.some(fn => fn.functionName === "hostError" && fn.ranges.some(range => range.count > 0))),
    "the actual checkout worker must still record a nonzero first-party function counter");
  const copiedRoot = pathToFileURL(f.omp + path.sep).href;
  assert.equal(scripts.filter(script => script.url.startsWith(copiedRoot)).length, 0,
    "copied CLI source lies outside the checkout coverage include pattern");
});
