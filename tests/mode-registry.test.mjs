import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ModeRegistryError,
  activateMode,
  createModeReceipt,
  createModeRegistry,
  diffModes,
  explainMode,
  scaffoldMode,
  validateModeReceipt,
} from "../packages/mode-registry/index.mjs";

const CATALOGS = {
  capabilities: ["workspace-read", "workspace-write", "web-access"],
  packages: ["fixture-package"],
  surfaces: ["fileToolPolicy", "webEgress"],
};

function manifest(id, overrides = {}) {
  const base = {
    $schema: "mode-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    id,
    version: "1.0.0",
    displayName: id,
    description: `Fixture mode ${id}`,
    category: "core",
    executionState: "ask",
    extends: [],
    aliases: [],
    requires: { profileCapabilities: [], packages: [], enforcementSurfaces: [] },
    prompt: { file: "prompt.md" },
    tools: { allow: ["read", "grep"], deny: ["edit", "write", "bash", "web"], required: ["read"] },
    policy: { workspace: "read-only", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" }, approval: "deny" },
    workflow: { default: "single-agent-safe", fallback: "single-agent-safe" },
    swarm: { allowed: false, defaultRecipe: null },
    completion: { gates: ["review"], requiresStructuredVerdict: true },
    risk: "low",
  };
  return {
    ...base,
    ...overrides,
    requires: { ...base.requires, ...(overrides.requires ?? {}) },
    prompt: { ...base.prompt, ...(overrides.prompt ?? {}) },
    tools: { ...base.tools, ...(overrides.tools ?? {}) },
    policy: { ...base.policy, ...(overrides.policy ?? {}), egress: { ...base.policy.egress, ...(overrides.policy?.egress ?? {}) } },
    workflow: { ...base.workflow, ...(overrides.workflow ?? {}) },
    swarm: { ...base.swarm, ...(overrides.swarm ?? {}) },
    completion: { ...base.completion, ...(overrides.completion ?? {}) },
  };
}

async function fixtureRoot(prefix = "only-my-pi-mode-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeMode(root, value, prompt = `# ${value.id}\n`) {
  const directory = path.join(root, value.id);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, "mode.json"), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(directory, "prompt.md"), prompt, { mode: 0o600 });
  return directory;
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

function registry(root, options = {}) {
  return createModeRegistry({
    sources: [{ kind: "builtin", root }],
    ...CATALOGS,
    ...options,
  });
}

async function expectCode(action, code) {
  await assert.rejects(action, (error) => error instanceof ModeRegistryError && error.code === code);
}

test("discovers deterministic manifests, validates prompts, and resolves aliases", async () => {
  const root = await fixtureRoot();
  try {
    await writeMode(root, manifest("base", { aliases: ["safe"] }));
    await writeMode(root, manifest("child", {
      extends: ["base"],
      tools: { allow: ["read"], deny: ["grep", "edit", "write", "bash", "web"], required: ["read"] },
    }));
    const first = registry(root);
    const second = registry(root, {
      fs: {
        readdir: async (...args) => [...await fs.readdir(...args)].reverse(),
        readFile: (...args) => fs.readFile(...args),
        lstat: (...args) => fs.lstat(...args),
        realpath: (...args) => fs.realpath(...args),
      },
    });
    const listed = await first.list();
    assert.deepEqual(listed.map((entry) => entry.id), ["base", "child"]);
    const resolved = await first.resolve("safe");
    const resolvedAgain = await second.resolve("child");
    assert.equal(resolved.modeId, "base");
    assert.equal(resolved.resolved.tools.allow.includes("read"), true);
    assert.equal(resolved.resolved.tools.allow.includes("grep"), true);
    assert.equal(resolvedAgain.hash, (await first.resolve("child")).hash);
    assert.equal(resolved.promptSources[0].hash.startsWith("sha256:"), true);
    const explanation = await first.explain("child");
    assert.deepEqual(explanation.lineage.map((entry) => entry.id), ["base", "child"]);
    assert.equal(explanation.decisions.some((entry) => entry.type === "tool-intersection"), true);
  } finally {
    await cleanup(root);
  }
});

test("inheritance only narrows tools/policy and rejects cycles or execution escalation", async () => {
  const root = await fixtureRoot();
  try {
    await writeMode(root, manifest("parent", {
      executionState: "plan",
      requires: { enforcementSurfaces: ["fileToolPolicy"] },
      policy: { workspace: "guarded-write", approval: "ask", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" } },
      tools: { allow: ["read", "grep", "edit"], deny: ["write", "bash", "web"], required: ["read"] },
    }));
    await writeMode(root, manifest("narrow", {
      extends: ["parent"],
      executionState: "ask",
      tools: { allow: ["read", "grep"], deny: ["edit", "write", "bash", "web"], required: ["read"] },
      policy: { workspace: "read-only", approval: "deny", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" } },
    }));
    await writeMode(root, manifest("wide", { extends: ["narrow"], executionState: "build", policy: { workspace: "guarded-write" } }));
    assert.equal((await registry(root).resolve("narrow")).resolved.policy.workspace, "read-only");
    // A child can narrow a guarded parent, but a build state cannot widen an ask parent.
    await expectCode(registry(root).resolve("wide"), "MODE_POLICY_ESCALATION");
  } finally {
    await cleanup(root);
  }

  const cycleRoot = await fixtureRoot();
  try {
    await writeMode(cycleRoot, manifest("a", { extends: ["b"] }));
    await writeMode(cycleRoot, manifest("b", { extends: ["a"] }));
    await expectCode(registry(cycleRoot).resolve("a"), "MODE_INHERITANCE_CYCLE");
  } finally {
    await cleanup(cycleRoot);
  }
});

test("fails closed on unknown catalogs, unsafe egress, path traversal, and symlinks", async () => {
  const root = await fixtureRoot();
  try {
    await writeMode(root, manifest("unknown-cap", { requires: { profileCapabilities: ["missing-cap"] } }));
    await expectCode(createModeRegistry({ sources: [{ kind: "builtin", root }], ...CATALOGS }).discover(), "UNKNOWN_CAPABILITY");
  } finally {
    await cleanup(root);
  }

  const egressRoot = await fixtureRoot();
  try {
    await writeMode(egressRoot, manifest("web-denied", { tools: { allow: ["read", "web"], deny: ["edit", "write", "bash"], required: ["read"] } }));
    await expectCode(registry(egressRoot).discover(), "EGRESS_TOOL_CONFLICT");
  } finally {
    await cleanup(egressRoot);
  }

  const pathRoot = await fixtureRoot();
  try {
    const value = manifest("escape", { prompt: { file: "../outside.md" } });
    await writeMode(pathRoot, value);
    await expectCode(registry(pathRoot).discover(), "INVALID_MODE_MANIFEST");
  } finally {
    await cleanup(pathRoot);
  }

  const symlinkRoot = await fixtureRoot();
  const outside = await fixtureRoot("only-my-pi-mode-outside-");
  try {
    await writeMode(symlinkRoot, manifest("linked"));
    await fs.unlink(path.join(symlinkRoot, "linked", "prompt.md"));
    await fs.symlink(path.join(outside, "prompt.md"), path.join(symlinkRoot, "linked", "prompt.md"));
    await fs.writeFile(path.join(outside, "prompt.md"), "outside\n");
    await expectCode(registry(symlinkRoot).discover(), "MODE_SYMLINK_ESCAPE");
  } finally {
    await cleanup(symlinkRoot);
    await cleanup(outside);
  }
});

test("enforces profile ceilings and source trust/namespaces", async () => {
  const root = await fixtureRoot();
  const user = await fixtureRoot();
  try {
    await writeMode(root, manifest("builtin", { requires: { profileCapabilities: ["workspace-read"] } }));
    await writeMode(user, manifest("custom"));
    await expectCode(registry(root, { profile: { capabilityIds: [], packageIds: [], policy: {} } }).resolve("builtin"), "PROFILE_CEILING_EXCEEDED");
    const namespaced = createModeRegistry({ sources: [{ kind: "builtin", root }, { kind: "user", root: user }], ...CATALOGS });
    const discovered = await namespaced.discover();
    assert.deepEqual(discovered.modes.map((entry) => entry.id), ["builtin", "user:custom"]);
    assert.equal((await namespaced.resolve("user:custom")).modeId, "user:custom");
  } finally {
    await cleanup(root);
    await cleanup(user);
  }

  assert.throws(() => createModeRegistry({ sources: [{ kind: "trusted-project", root: "/tmp/modes", trusted: false }] }), (error) => error.code === "UNTRUSTED_MODE_SOURCE");
  assert.throws(() => createModeRegistry({ reviewedPackages: [{ packageId: "fixture-package", root: "/tmp/modes", reviewed: false }] }), (error) => error.code === "UNTRUSTED_MODE_SOURCE");
});

test("reviewed package namespaces may reuse raw IDs but never create an implicit winner", async () => {
  const firstRoot = await fixtureRoot();
  const secondRoot = await fixtureRoot();
  try {
    await writeMode(firstRoot, manifest("inspect"));
    await writeMode(secondRoot, manifest("inspect"));
    const r = createModeRegistry({
      reviewedPackages: [
        { packageId: "package-one", root: firstRoot, reviewed: true },
        { packageId: "package-two", root: secondRoot, reviewed: true },
      ],
      ...CATALOGS,
    });
    const listed = await r.list();
    assert.deepEqual(listed.map((entry) => entry.id), ["package-one/inspect", "package-two/inspect"]);
    assert.equal((await r.resolve("package-one/inspect")).modeId, "package-one/inspect");
    await expectCode(r.resolve("inspect"), "AMBIGUOUS_MODE_REFERENCE");
  } finally {
    await cleanup(firstRoot);
    await cleanup(secondRoot);
  }
});

test("rootDir keeps built-ins when optional search roots are also supplied", async () => {
  const repository = await fixtureRoot();
  const user = await fixtureRoot();
  try {
    await writeMode(path.join(repository, "modes"), manifest("builtin-default"));
    await writeMode(user, manifest("custom-search"));
    const r = createModeRegistry({ rootDir: repository, searchRoots: [{ kind: "user", root: user }], ...CATALOGS });
    assert.deepEqual((await r.list()).map((entry) => entry.id), ["builtin-default", "user:custom-search"]);
  } finally {
    await cleanup(repository);
    await cleanup(user);
  }
});

test("diff and idle-only activation fail closed across hard envelopes and stale source", async () => {
  const root = await fixtureRoot();
  try {
    await writeMode(root, manifest("read-mode"));
    await writeMode(root, manifest("write-mode", {
      requires: { enforcementSurfaces: ["fileToolPolicy"] },
      policy: { workspace: "guarded-write", approval: "ask" },
      tools: { allow: ["read", "edit"], deny: ["write", "bash", "web"], required: ["read"] },
    }));
    const r = registry(root);
    const read = await r.resolve("read-mode");
    const write = await r.resolve("write-mode");
    const diff = diffModes(read, write);
    assert.equal(diff.hardEnvelopeChanged, true);
    assert.equal(diff.restartRequired, true);
    const idle = { isIdle: async () => true, injectPrompt: async () => {}, setStatus: async () => {}, appendEntry: async () => {} };
    const same = await activateMode(r, "read-mode", { currentSnapshot: read, session: idle });
    assert.equal(same.status, "APPLIED");
    const busy = await activateMode(r, "read-mode", { currentSnapshot: read, session: { isIdle: async () => false } });
    assert.equal(busy.status, "SESSION_NOT_IDLE");
    const restart = await activateMode(r, "write-mode", { currentSnapshot: read, session: idle });
    assert.equal(restart.status, "RESTART_REQUIRED");
    const applied = await activateMode(r, "write-mode", {
      currentSnapshot: read,
      session: idle,
      sessionDriver: {
        probe: async () => ({ owner: "fixture-driver", canSwitchAtRuntime: true }),
        apply: async () => ({ status: "APPLIED" }),
      },
    });
    assert.equal(applied.status, "APPLIED");
    const unavailable = await activateMode(r, "write-mode", {
      currentSnapshot: read,
      session: idle,
      sessionDriver: { probe: async () => ({ owner: "fixture-driver", canSwitchAtRuntime: false }), apply: async () => ({}) },
    });
    assert.equal(unavailable.status, "UNAVAILABLE");

    await fs.appendFile(path.join(root, "read-mode", "prompt.md"), "drift\n");
    const stale = await activateMode(r, "read-mode", { currentSnapshot: read, session: idle });
    assert.equal(stale.status, "STALE_MODE_SNAPSHOT");
  } finally {
    await cleanup(root);
  }
});

test("activation persists a bounded receipt without prompt text or host paths", async () => {
  const root = await fixtureRoot();
  try {
    await writeMode(root, manifest("receipt-mode"), "private prompt text that must not enter the receipt\n");
    const r = registry(root);
    const target = await r.resolve("receipt-mode");
    const entries = [];
    const result = await activateMode(r, "receipt-mode", {
      currentSnapshot: target,
      session: {
        isIdle: async () => true,
        injectPrompt: async () => {},
        setStatus: async () => {},
        appendEntry: async (entry) => entries.push(entry),
      },
    });
    assert.equal(result.status, "APPLIED");
    assert.equal(validateModeReceipt(entries[0].receipt).valid, true);
    const serialized = JSON.stringify(entries[0].receipt);
    assert.equal(serialized.includes("private prompt text"), false);
    assert.equal(serialized.includes(path.resolve(root)), false);
    assert.equal(Object.hasOwn(entries[0].receipt.snapshot.resolved, "prompt"), false);
    assert.equal(Object.hasOwn(entries[0].receipt.snapshot.resolved, "cwd"), false);
    assert.deepEqual(createModeReceipt(target), entries[0].receipt);
  } finally {
    await cleanup(root);
  }
});

test("scaffold is read-only by default and writes only with explicit destination", async () => {
  const registry = createModeRegistry({ capabilities: [], packages: [], enforcementSurfaces: [] });
  const plan = scaffoldMode(registry, { id: "new-mode" });
  assert.equal(plan.status, "PLAN_ONLY");
  assert.equal(plan.files.length, 2);
  const destination = await fixtureRoot("only-my-pi-mode-scaffold-");
  const target = path.join(destination, "new-mode");
  try {
    const result = await scaffoldMode(registry, { id: "new-mode", destination: target, write: true });
    assert.equal(result.status, "WRITTEN");
    assert.equal((await fs.stat(path.join(target, "mode.json"))).isFile(), true);
    await assert.rejects(scaffoldMode(registry, { id: "new-mode", destination: target, write: true }), /EEXIST/);
  } finally {
    await cleanup(destination);
  }
  assert.throws(() => scaffoldMode(registry, { id: "../unsafe" }), (error) => error.code === "INVALID_MODE_ID");
});
