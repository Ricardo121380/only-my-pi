import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the real interactive SDK loadout with a scripted approval UI. This
// proves authorization behavior, not terminal rendering or browser usability.
const [packageRoot, configRoot, sessionDir] = process.argv.slice(2);
const load = relative => import(pathToFileURL(path.join(packageRoot, relative)).href);
const { resolveControlledStack, resolveDirectExtensionSet, buildDirectPiInvocation } = await load("packages/direct-agent/launcher.mjs");
const stack = await resolveControlledStack({ packageRoot });
const { extensions } = await resolveDirectExtensionSet({ stack, configRoot, minimal: true });
const invocation = buildDirectPiInvocation({ stack, extensionPaths: extensions, interactive: true,
  argv: ["--minimal", "--model", "fixture/one", "--session-dir", sessionDir] });
Object.assign(process.env, invocation.env);
const sdk = await import(pathToFileURL(path.join(stack.root, "pi/dist/index.js")).href);
const { SessionAdmissions } = await load("packages/direct-agent/session-admission.mjs");
const { createDirectTuiRuntime } = await load("packages/direct-agent/tui-runtime.mjs");
const { acquireOwnership } = await load("packages/process-runtime/ownership.mjs");
let approvals = 0;
const uiContext = {
  setEditorComponent() {}, setStatus() {}, setWidget() {}, setTitle() {}, notify() {},
  async select(title, options) {
    assert.match(title, /Allow project-local coding/);
    approvals++;
    return options[0];
  },
};
const open = async (args = []) => {
  const admissions = new SessionAdmissions(configRoot, { loadSdk: async () => sdk });
  const { runtime } = await createDirectTuiRuntime({ sdk, admissions, configRoot, args: [...invocation.argv.slice(3), ...args] });
  for (const method of ["getSettings", "getGlobalSettings", "getProjectSettings"])
    assert.deepEqual(runtime.services.settingsManager[method]().packages, []);
  assert.deepEqual(runtime.services.settingsManager.getPackages(), []);
  await runtime.services.settingsManager.reload();
  assert.deepEqual(runtime.services.settingsManager.getGlobalSettings().packages, [], "reload must not restore ambient packages");
  await runtime.session.bindExtensions({ mode: "tui", uiContext });
  return runtime;
};
const runtime = await open();
let sessionFile, id;
try {
  assert.ok(!runtime.session.getActiveToolNames().includes("write"));
  const run = async () => {
    const settled = new Promise(resolve => {
    const off = runtime.session.subscribe(event => { if (event.type === "agent_settled") { off(); resolve(); } });
    });
    await runtime.session.prompt("approved write");
    await settled;
  };
  await run();
  assert.equal(approvals, 1);
  assert.ok(runtime.session.getActiveToolNames().includes("write"));
  const beforeRevoke = runtime.session.messages.length;
  await runtime.session.prompt("/access revoke");
  assert.equal(runtime.session.messages.length, beforeRevoke, "local revoke must not submit another model turn");
  assert.ok(!runtime.session.getActiveToolNames().includes("write"));
  // Regain a fresh grant, then close while it is still active. Restoring this
  // history must also start in Inspect, independently of the revoke case.
  await run();
  assert.equal(approvals, 2);
  assert.ok(runtime.session.getActiveToolNames().includes("write"));
  sessionFile = runtime.session.sessionFile; id = runtime.session.sessionId;
} finally { await runtime.dispose(); }
const project = await acquireOwnership(configRoot, "project", process.cwd()); await project.release();
const resumed = await open(["--session", sessionFile]);
try {
  assert.equal(resumed.session.sessionId, id);
  assert.ok(!resumed.session.getActiveToolNames().includes("write"), "history must not restore a coding grant");
  assert.equal(approvals, 2);
} finally { await resumed.dispose(); }
process.stdout.write(JSON.stringify({ approvals, resumedWithoutGrant: true, disposed: true }) + "\n");
