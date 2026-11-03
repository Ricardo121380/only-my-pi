import assert from "node:assert/strict";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const loaded = [];
registerHooks({ load(url, context, next) {
  if (url.startsWith("file:")) {
    const relative = path.relative(root, fileURLToPath(url));
    if (!relative.startsWith("..") && !relative.startsWith("node_modules/")) loaded.push(relative);
  }
  return next(url, context);
} });
const cli = await import("../../bin/omp.mjs");
const [scenario, configRoot] = process.argv.slice(2);
let stdout = "", stderr = "", code = 0, called = false;
const options = { env: {}, homedir: () => configRoot, stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } };
if (scenario === "agent-help") code = await cli.runOmpEntrypoint({ ...options, argv: ["--help"] });
else if (scenario === "admin-help") code = await cli.runOmpEntrypoint({ ...options, argv: ["admin", "help"] });
else if (scenario === "agent") {
  code = await cli.runOmpEntrypoint({ ...options, argv: ["--", "web"], agentLauncher: async input => {
    assert.deepEqual(input.argv, ["--", "web"]); assert.equal(input.packageRoot, path.resolve(root)); called = true;
  } });
  assert.equal(called, true);
} else if (scenario === "web") {
  code = await cli.runOmpEntrypoint({ ...options, argv: ["web", "status"], webCommand: async input => {
    assert.deepEqual(input.argv, ["status"]); called = true; return { ok: true, status: "STOPPED" };
  } });
  assert.equal(called, true);
} else if (scenario === "account-list") code = await cli.runOmpEntrypoint({ ...options, argv: ["account", "list"] });
else if (scenario === "injected-admin") {
  code = await cli.runOmpEntrypoint({ ...options, argv: ["admin", "status", "--json"], service: { dispatch: async input => {
    assert.equal(input.command, "status"); called = true; return { ok: true, status: "INJECTED" };
  } } });
  assert.equal(called, true);
} else if (scenario === "factory") {
  const service = cli.createProductionControlService({ configRoot });
  assert.equal(typeof service.dispatch, "function");
  assert.equal(service.then, undefined, "the public factory must remain synchronous");
} else assert.equal(scenario, "import");
assert.equal(code, 0, stderr);
assert.equal(stderr, "");
process.stdout.write(JSON.stringify({ scenario, loaded, stdout, code }));
