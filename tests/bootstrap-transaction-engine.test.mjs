import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ABSENT_SETTINGS_DIGEST,
  TRANSACTION_PHASES,
  canonicalJson,
  createJournal,
  hashFile,
  listTransactionJournals,
  loadJournal,
  loadOwnedSettingsSnapshot,
  loadSettings,
  readState,
  saveSettings,
  sha256,
  settingsDigest,
  verifyLastKnownGood,
} from "../packages/config-runtime/index.mjs";
import {
  buildGenerationPlan,
  createGenerationLayout,
} from "../packages/bootstrap/index.mjs";
import {
  BOOTSTRAP_OWNED_PATHS,
  TRANSACTION_DURABLE_BOUNDARIES,
  compileRollbackSettings,
  createCrashBoundary,
  createTransactionEngine,
} from "../packages/bootstrap/transaction-engine.mjs";
import {
  compileUninstalledSettings,
  extractManagedMetadata,
} from "../packages/bootstrap/settings-merge.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GRAPH_PLAN = await buildGenerationPlan({ rootDir: ROOT_DIR, profileId: "coding" });
const MANIFEST_NAME = ".only-my-pi-generation.json";

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function transactionIds(start = 1) {
  let next = start;
  return () => uuid(next++);
}

async function isolatedConfigRoot(t) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-transaction-"));
  t.after(async () => fs.rm(configRoot, { recursive: true, force: true }));
  return configRoot;
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function initialUserSettings() {
  return {
    editor: { theme: "user-owned", fontSize: 15 },
    unrelated: { preserve: true, nested: [1, 2, 3] },
  };
}

function desiredMetadata(overrides = {}) {
  return {
    profileId: "coding",
    generationId: GRAPH_PLAN.graphDigest,
    graphDigest: GRAPH_PLAN.graphDigest,
    providerSelection: {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      status: "CONFIGURED_UNVERIFIED",
    },
    initialMode: {
      id: "coding",
      status: "PENDING_M3_RESOLUTION",
    },
    ...overrides,
  };
}

function installedMetadata() {
  return {
    formatVersion: 1,
    ...desiredMetadata(),
    managedSettings: {
      packages: [`./only-my-pi/generations/${GRAPH_PLAN.generationKey}/fake-package`],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    },
  };
}

async function bootstrapPlan(configRoot, options = {}) {
  const current = await loadSettings(configRoot);
  return {
    formatVersion: 1,
    kind: options.kind ?? "only-my-pi-bootstrap-plan",
    operation: options.operation ?? "bootstrap",
    status: options.status ?? "PLAN_READY",
    planDigest: options.planDigest ?? `sha256:${"c".repeat(64)}`,
    configRoot,
    profileId: "coding",
    sourceSettings: { exists: current.exists, digest: current.digest },
    graphPlan: GRAPH_PLAN,
    desired: { metadata: desiredMetadata(options.metadata) },
  };
}

async function uninstallPlan(configRoot, options = {}) {
  const current = await loadSettings(configRoot);
  const metadata = extractManagedMetadata(current.settings);
  const intended = metadata === null ? current.settings : compileUninstalledSettings(current.settings);
  return {
    formatVersion: 1,
    kind: "only-my-pi-uninstall-plan",
    operation: "uninstall",
    status: options.status ?? (metadata === null ? "NO_CHANGES" : "PLAN_READY"),
    planDigest: `sha256:${"d".repeat(64)}`,
    configRoot,
    profileId: metadata?.profileId ?? "minimal",
    sourceSettings: { exists: current.exists, digest: current.digest },
    current: { metadata },
    desired: { metadata: null, settingsDigest: settingsDigest(intended) },
  };
}

async function rollbackPlan(configRoot, snapshotId) {
  const current = await loadSettings(configRoot);
  const snapshot = await loadOwnedSettingsSnapshot(configRoot, snapshotId);
  const intended = compileRollbackSettings(current.settings, snapshot);
  const metadata = extractManagedMetadata(intended);
  return {
    formatVersion: 1,
    kind: "only-my-pi-rollback-plan",
    operation: "rollback",
    status: "PLAN_READY",
    planDigest: `sha256:${"e".repeat(64)}`,
    configRoot,
    profileId: metadata?.profileId ?? "minimal",
    snapshotId,
    sourceSettings: { exists: current.exists, digest: current.digest },
    desired: { metadata, settingsDigest: settingsDigest(intended) },
  };
}

function fakeManifest(plan) {
  return {
    formatVersion: 1,
    graphDigest: plan.graphDigest,
    generationKey: plan.generationKey,
    profileId: plan.profileId,
    manifestDigest: `sha256:${plan.generationKey.split("").reverse().join("")}`,
  };
}

function assertManagedTestPath(layout, target) {
  const relative = path.relative(layout.configRoot, target);
  assert.ok(relative.startsWith(`only-my-pi${path.sep}generations${path.sep}`));
  assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function createFakeGenerationRuntime(controls, stats) {
  async function readVerified(layout, expectedManifestDigest) {
    assertManagedTestPath(layout, layout.generationRoot);
    const manifestPath = path.join(layout.generationRoot, layout.manifestName);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.graphDigest, `sha256:${layout.generationKey}`);
    if (expectedManifestDigest !== undefined) {
      assert.equal(manifest.manifestDigest, expectedManifestDigest);
    }
    const receipt = {
      formatVersion: 1,
      status: "VERIFIED_PROMOTED",
      graphDigest: manifest.graphDigest,
      generationKey: manifest.generationKey,
      generationRoot: layout.generationRoot,
      manifestDigest: manifest.manifestDigest,
      realizedDigest: `sha256:${"a".repeat(64)}`,
    };
    return { manifest, receipt };
  }

  return {
    buildPlan: async ({ rootDir, profileId }) => {
      assert.equal(rootDir, ROOT_DIR);
      assert.equal(profileId, "coding");
      stats.graphPlans += 1;
      return GRAPH_PLAN;
    },
    createLayout: createGenerationLayout,
    stageAndPromote: async ({ plan, configRoot, transactionId, runCommand, promote }) => {
      stats.stages += 1;
      assert.equal(typeof runCommand, "function");
      const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId });
      controls.onStageEntered?.(layout);
      if (controls.stageGate) await controls.stageGate;
      if (await exists(layout.generationRoot)) {
        const verified = await readVerified(layout);
        return { layout, manifest: verified.manifest, receipt: verified.receipt };
      }
      await fs.mkdir(layout.stagingRoot, { recursive: true, mode: 0o700 });
      await fs.mkdir(path.join(layout.stagingRoot, "fake-package"), { recursive: true });
      await fs.writeFile(path.join(layout.stagingRoot, "fake-package", "index.mjs"), "export default true;\n");
      const manifest = fakeManifest(plan);
      await fs.writeFile(path.join(layout.stagingRoot, layout.manifestName), `${JSON.stringify(manifest)}\n`);
      if (controls.failStage) {
        const error = new Error("injected offline staging failure");
        error.code = "FAKE_STAGING_FAILURE";
        throw error;
      }
      await promote({
        stagingRoot: layout.stagingRoot,
        generationRoot: layout.generationRoot,
        graphDigest: plan.graphDigest,
        manifestDigest: manifest.manifestDigest,
      });
      const verified = await readVerified(layout);
      return { layout, manifest: verified.manifest, receipt: verified.receipt };
    },
    verifyPromoted: async ({ plan, layout }) => {
      const verified = await readVerified(layout);
      assert.equal(verified.manifest.graphDigest, plan.graphDigest);
      return verified;
    },
    verifyByManifest: async ({ layout, expectedManifestDigest }) => readVerified(layout, expectedManifestDigest),
    compileSettings: async ({ plan, promotion, configRoot }) => {
      assert.equal(promotion.graphDigest, plan.graphDigest);
      const layout = createGenerationLayout({
        configRoot,
        graphDigest: plan.graphDigest,
        transactionId: "fake-settings-compiler",
      });
      assert.equal(await exists(path.join(layout.generationRoot, "fake-package")), true);
      return {
        formatVersion: 1,
        status: "VERIFIED",
        graphDigest: plan.graphDigest,
        generationKey: plan.generationKey,
        generationRelativeRoot: `./only-my-pi/generations/${plan.generationKey}`,
        ownedSettings: {
          packages: [`./only-my-pi/generations/${plan.generationKey}/fake-package`],
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        },
      };
    },
    removeStaging: async ({ layout }) => {
      assertManagedTestPath(layout, layout.stagingRoot);
      const present = await exists(layout.stagingRoot);
      if (present) await fs.rm(layout.stagingRoot, { recursive: true, force: false });
      return present;
    },
    removeUnreferenced: async ({ layout, expectedManifestDigest }) => {
      assertManagedTestPath(layout, layout.generationRoot);
      if (!(await exists(layout.generationRoot))) return false;
      await readVerified(layout, expectedManifestDigest);
      await fs.rm(layout.generationRoot, { recursive: true, force: false });
      return true;
    },
  };
}

function harness(options = {}) {
  const controls = options.controls ?? {};
  const stats = { graphPlans: 0, stages: 0, runnerCalls: 0, doctorCalls: 0, smokeCalls: 0 };
  const generationRuntime = createFakeGenerationRuntime(controls, stats);
  const engine = createTransactionEngine({
    rootDir: ROOT_DIR,
    generationRuntime,
    transactionIdFactory: options.transactionIdFactory ?? transactionIds(),
    onBoundary: options.onBoundary,
    settingsAtomic: options.settingsAtomic,
    runner: async () => {
      stats.runnerCalls += 1;
      assert.fail("the deterministic transaction tests must never invoke npm or another subprocess");
    },
    doctorService: {
      static(args) {
        stats.doctorCalls += 1;
        controls.onDoctor?.(args);
        return controls.doctorResult ?? { ok: true, errors: 0, warnings: 0 };
      },
    },
    smokeRunner: async (args) => {
      stats.smokeCalls += 1;
      controls.onSmoke?.(args);
      return controls.smokeResult ?? {
        ok: true,
        status: "NO_MODEL_STARTUP_VERIFIED",
        providerRequests: 0,
        credentialsRead: 0,
      };
    },
  });
  return { engine, stats, generationRuntime };
}

async function assertNoDanglingSettings(configRoot) {
  const current = await loadSettings(configRoot);
  const metadata = extractManagedMetadata(current.settings);
  if (metadata === null) return;
  assert.equal(metadata.generationId, metadata.graphDigest);
  const generationRoot = path.join(configRoot, "only-my-pi", "generations", metadata.generationId.slice(7));
  assert.equal(await exists(generationRoot), true, "settings metadata must reference an existing generation");
  for (const field of ["packages", "extensions", "skills", "prompts", "themes"]) {
    for (const entry of metadata.managedSettings[field]) {
      const value = typeof entry === "string" ? entry : entry.source;
      assert.equal(typeof value, "string");
      assert.ok(value.startsWith("./only-my-pi/generations/"));
      const target = path.resolve(configRoot, value.slice(2));
      assert.ok(target.startsWith(`${configRoot}${path.sep}`));
      assert.equal(await exists(target), true, `${field} must not reference an absent generation path`);
    }
  }
}

async function fileTreeSnapshot(root) {
  const output = {};
  async function visit(directory, prefix = "") {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) output[relative] = await fs.readFile(absolute, "utf8");
      else output[relative] = `<${entry.isSymbolicLink() ? "symlink" : "other"}>`;
    }
  }
  await visit(root);
  return output;
}

test("transaction engine requires an explicit isolated absolute configRoot before any write", async () => {
  const { engine } = harness();
  const plan = {
    ...(await bootstrapPlan(path.join(os.tmpdir(), "only-my-pi-unused-plan-root"), { status: "NO_CHANGES" })),
    configRoot: "relative-config-root-that-must-not-be-created",
  };
  await assert.rejects(engine.applyGraphPlan(plan, { operation: "bootstrap" }), { code: "CONFIG_ROOT_NOT_ABSOLUTE" });
  await assert.rejects(
    engine.applyUninstallPlan({ ...plan, status: "NO_CHANGES", configRoot: "/" }),
    { code: "CONFIG_ROOT_TOO_BROAD" },
  );
  await assert.rejects(
    engine.applyGraphPlan({ ...plan, configRoot: undefined }, { operation: "bootstrap" }),
    { code: "CONFIG_ROOT_REQUIRED" },
  );
  assert.equal(await exists(path.join(ROOT_DIR, "relative-config-root-that-must-not-be-created")), false);
});

test("first apply publishes settings last, records exact journal/snapshot/LKG evidence, and second apply is idempotent", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const initial = initialUserSettings();
  await saveSettings(configRoot, initial);
  const events = [];
  const { engine, stats } = harness({
    transactionIdFactory: transactionIds(1),
    onBoundary: async (name) => {
      const current = await loadSettings(configRoot);
      events.push({ name, settingsDigest: current.digest, metadata: extractManagedMetadata(current.settings) });
    },
  });
  const plan = await bootstrapPlan(configRoot);
  const result = await engine.applyGraphPlan(plan, { operation: "bootstrap" });
  assert.equal(result.status, "COMMITTED");
  assert.equal(result.lastKnownGood, "RECORDED");
  assert.equal(stats.runnerCalls, 0);
  assert.equal(stats.stages, 1);
  assert.equal(stats.smokeCalls, 1);

  const current = await loadSettings(configRoot);
  assert.deepEqual(current.settings.editor, initial.editor);
  assert.deepEqual(current.settings.unrelated, initial.unrelated);
  assert.deepEqual(extractManagedMetadata(current.settings), installedMetadata());
  await assertNoDanglingSettings(configRoot);

  const renamedIndex = events.findIndex((entry) => entry.name === "GENERATION_RENAMED");
  const settingsIndex = events.findIndex((entry) => entry.name === "SETTINGS_RENAMED");
  assert.ok(renamedIndex >= 0 && settingsIndex > renamedIndex);
  assert.equal(events[renamedIndex].metadata, null, "generation must be durable before settings become visible");
  assert.deepEqual(events[settingsIndex].metadata, installedMetadata());

  const journals = await listTransactionJournals(configRoot);
  assert.equal(journals.length, 1);
  const journal = journals[0];
  assert.equal(journal.status, "COMMITTED");
  assert.deepEqual(journal.phaseHistory, TRANSACTION_PHASES);
  assert.equal(journal.promotionCreated, true);
  assert.equal(journal.intendedSettingsDigest, current.digest);
  assert.equal(journal.generationManifestDigest, fakeManifest(GRAPH_PLAN).manifestDigest);

  const snapshot = await loadOwnedSettingsSnapshot(configRoot, journal.snapshotId);
  assert.deepEqual(snapshot.owned.paths, BOOTSTRAP_OWNED_PATHS);
  assert.equal(snapshot.source.exists, true);
  assert.equal(snapshot.source.digest, plan.sourceSettings.digest);
  const state = await readState(configRoot);
  assert.equal(state.generationId, GRAPH_PLAN.graphDigest);
  assert.equal(state.settingsDigest, current.digest);
  assert.equal(state.transactionId, journal.transactionId);
  assert.deepEqual(state.metadata, {
    providerSelection: desiredMetadata().providerSelection,
    initialMode: desiredMetadata().initialMode,
  });
  const manifestPath = path.join(configRoot, ...state.generationManifestRelativePath.split("/"));
  assert.equal(state.generationManifestDigest, await hashFile(configRoot, manifestPath));
  assert.equal((await verifyLastKnownGood(configRoot)).ok, true);

  const beforeNoOp = await fileTreeSnapshot(configRoot);
  const noChange = await bootstrapPlan(configRoot, { status: "NO_CHANGES" });
  const second = await engine.applyGraphPlan(noChange, { operation: "bootstrap" });
  assert.equal(second.status, "NO_CHANGES");
  assert.equal(second.mutation, false);
  assert.deepEqual(await fileTreeSnapshot(configRoot), beforeNoOp);
  assert.equal((await listTransactionJournals(configRoot)).length, 1);
  assert.equal(await exists(path.join(configRoot, "auth.json")), false);
  assert.equal(await exists(path.join(configRoot, "sessions")), false);
  assert.equal(await exists(path.join(configRoot, "cache")), false);
});

test("every graph transaction durable boundary is recoverable, including a visible NO_CHANGES crash state", async (t) => {
  const graphBoundaries = TRANSACTION_DURABLE_BOUNDARIES.filter((name) => name !== "LAST_KNOWN_GOOD_CLEARED");
  assert.deepEqual(graphBoundaries, [
    "PREPARED",
    "BACKUP_DURABLE",
    "GRAPH_STAGING",
    "GRAPH_STAGED",
    "GRAPH_VERIFIED",
    "GENERATION_RENAMED",
    "GRAPH_PROMOTED",
    "SETTINGS_RENAMED",
    "SETTINGS_PUBLISHED",
    "STATIC_DOCTOR_PASSED",
    "SMOKE_PASSED",
    "LAST_KNOWN_GOOD_RECORDED",
    "COMMITTED",
  ]);
  const visibleTargetBoundaries = new Set([
    "SETTINGS_RENAMED",
    "SETTINGS_PUBLISHED",
    "STATIC_DOCTOR_PASSED",
    "SMOKE_PASSED",
    "LAST_KNOWN_GOOD_RECORDED",
  ]);

  for (const [index, boundary] of graphBoundaries.entries()) {
    await t.test(boundary, async (t) => {
      const configRoot = await isolatedConfigRoot(t);
      const initial = initialUserSettings();
      await saveSettings(configRoot, initial);
      const crashed = harness({
        transactionIdFactory: transactionIds(index * 10 + 1),
        onBoundary: createCrashBoundary(boundary),
      });
      const originalPlan = await bootstrapPlan(configRoot);
      await assert.rejects(
        crashed.engine.applyGraphPlan(originalPlan, { operation: "bootstrap" }),
        (error) => error?.code === "SIMULATED_PROCESS_CRASH" && error.simulateCrash === true,
      );
      assert.equal(crashed.stats.runnerCalls, 0);
      await assertNoDanglingSettings(configRoot);

      if (boundary === "COMMITTED") {
        assert.deepEqual(extractManagedMetadata((await loadSettings(configRoot)).settings), installedMetadata());
        assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
        assert.equal((await readState(configRoot)).generationId, GRAPH_PLAN.graphDigest);
        const noChange = await bootstrapPlan(configRoot, { status: "NO_CHANGES" });
        const noOp = await harness({ transactionIdFactory: transactionIds(index * 10 + 2) })
          .engine.applyGraphPlan(noChange, { operation: "bootstrap" });
        assert.equal(noOp.status, "NO_CHANGES");
      } else if (visibleTargetBoundaries.has(boundary)) {
        const apparentNoChange = await bootstrapPlan(configRoot, { status: "NO_CHANGES" });
        const recovery = await harness({ transactionIdFactory: transactionIds(index * 10 + 2) })
          .engine.applyGraphPlan(apparentNoChange, { operation: "bootstrap" });
        assert.equal(recovery.status, "RECOVERED_REPLAN_REQUIRED");
        assert.equal(recovery.mutation, true);
        assert.equal(recovery.recovered.length, 1);
        assert.deepEqual((await loadSettings(configRoot)).settings, initial);

        const replanned = await bootstrapPlan(configRoot);
        const completed = await harness({ transactionIdFactory: transactionIds(index * 10 + 2) })
          .engine.applyGraphPlan(replanned, { operation: "bootstrap" });
        assert.equal(completed.status, "COMMITTED");
      } else {
        const completed = await harness({ transactionIdFactory: transactionIds(index * 10 + 2) })
          .engine.applyGraphPlan(originalPlan, { operation: "bootstrap" });
        assert.equal(completed.status, "COMMITTED");
        assert.equal(completed.recovered.length, 1);
      }

      await assertNoDanglingSettings(configRoot);
      assert.deepEqual(extractManagedMetadata((await loadSettings(configRoot)).settings), installedMetadata());
      assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
      assert.equal((await readState(configRoot)).settingsDigest, (await loadSettings(configRoot)).digest);
      const statuses = (await listTransactionJournals(configRoot)).map((journal) => journal.status).sort();
      assert.deepEqual(statuses, boundary === "COMMITTED" ? ["COMMITTED"] : ["COMMITTED", "ROLLED_BACK"]);
    });
  }
});

test("staging, settings publication, doctor, and no-model smoke failures roll back exact owned state", async (t) => {
  const cases = [
    { name: "staging", controls: { failStage: true }, expected: "FAKE_STAGING_FAILURE" },
    { name: "settings", settingsAtomic: { failAtPhase: "BEFORE_RENAME" }, expected: "INJECTED_ATOMIC_WRITE_FAILURE" },
    { name: "doctor", controls: { doctorResult: { ok: false, errors: 1 } }, expected: "STATIC_DOCTOR_FAILED" },
    { name: "smoke", controls: { smokeResult: { ok: false, providerRequests: 0 } }, expected: "NO_MODEL_SMOKE_FAILED" },
  ];
  for (const [index, failure] of cases.entries()) {
    await t.test(failure.name, async (t) => {
      const configRoot = await isolatedConfigRoot(t);
      const initial = initialUserSettings();
      await saveSettings(configRoot, initial);
      const { engine, stats } = harness({
        controls: failure.controls,
        settingsAtomic: failure.settingsAtomic,
        transactionIdFactory: transactionIds(index + 200),
      });
      const plan = await bootstrapPlan(configRoot);
      await assert.rejects(
        engine.applyGraphPlan(plan, { operation: "bootstrap" }),
        (error) => error?.code === "TRANSACTION_ROLLED_BACK" && error.originalCode === failure.expected,
      );
      const current = await loadSettings(configRoot);
      assert.deepEqual(current.settings, initial);
      assert.equal(extractManagedMetadata(current.settings), null);
      assert.equal(stats.runnerCalls, 0);
      assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
      assert.deepEqual((await listTransactionJournals(configRoot)).map((journal) => journal.status), ["ROLLED_BACK"]);
      const generationsRoot = path.join(configRoot, "only-my-pi", "generations");
      const leftovers = await fs.readdir(generationsRoot).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
      assert.deepEqual(leftovers, []);
      await assert.rejects(readState(configRoot), { code: "ENOENT" });
    });
  }
});

test("graph publication CAS preserves a concurrent settings write and requires a fresh plan", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const initial = initialUserSettings();
  await saveSettings(configRoot, initial);
  const concurrentUserField = { preserve: true, writer: "external" };
  let injected = false;
  const raced = harness({
    transactionIdFactory: transactionIds(250),
    onBoundary: async (name) => {
      if (name !== "GRAPH_PROMOTED" || injected) return;
      injected = true;
      const observed = await loadSettings(configRoot);
      await saveSettings(configRoot, {
        ...observed.settings,
        concurrentUserField,
      });
    },
  });
  const stalePlan = await bootstrapPlan(configRoot);

  await assert.rejects(
    raced.engine.applyGraphPlan(stalePlan, { operation: "bootstrap" }),
    (error) => {
      assert.equal(error?.code, "CONCURRENT_SETTINGS_CHANGE");
      assert.equal(error.atomicPublication, "NOT_PUBLISHED");
      assert.equal(error.recovery?.status, "FAILED");
      assert.equal(error.recovery?.settingsDisposition, "PRESERVE_CONCURRENT");
      return true;
    },
  );

  const preserved = await loadSettings(configRoot);
  assert.deepEqual(preserved.settings, { ...initial, concurrentUserField });
  assert.equal(extractManagedMetadata(preserved.settings), null);
  assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
  const [failedJournal] = await listTransactionJournals(configRoot);
  assert.equal(failedJournal.status, "FAILED");
  assert.equal(failedJournal.failureCode, "CONCURRENT_SETTINGS_CHANGE");
  assert.equal(
    await exists(path.join(configRoot, "only-my-pi", "generations", GRAPH_PLAN.generationKey)),
    false,
  );

  const replanned = await bootstrapPlan(configRoot);
  assert.notEqual(replanned.sourceSettings.digest, stalePlan.sourceSettings.digest);
  const committed = await harness({ transactionIdFactory: transactionIds(251) })
    .engine.applyGraphPlan(replanned, { operation: "bootstrap" });
  assert.equal(committed.status, "COMMITTED");
  const final = await loadSettings(configRoot);
  assert.deepEqual(final.settings.concurrentUserField, concurrentUserField);
  assert.deepEqual(extractManagedMetadata(final.settings), installedMetadata());
  await assertNoDanglingSettings(configRoot);
});

test("hard-crash recovery preserves a third settings digest before publication and fails the stale plan", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const initial = initialUserSettings();
  await saveSettings(configRoot, initial);
  const concurrentUserField = { preserve: true, writer: "external-after-crash" };
  const stalePlan = await bootstrapPlan(configRoot);
  const crashed = harness({
    transactionIdFactory: transactionIds(260),
    onBoundary: async (name) => {
      if (name !== "GRAPH_PROMOTED") return;
      const observed = await loadSettings(configRoot);
      await saveSettings(configRoot, {
        ...observed.settings,
        concurrentUserField,
      });
      const error = new Error("simulated process crash after an external settings write");
      error.code = "SIMULATED_PROCESS_CRASH";
      error.simulateCrash = true;
      throw error;
    },
  });

  await assert.rejects(
    crashed.engine.applyGraphPlan(stalePlan, { operation: "bootstrap" }),
    (error) => error?.code === "SIMULATED_PROCESS_CRASH" && error.simulateCrash === true,
  );
  assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 1);
  assert.equal(
    await exists(path.join(configRoot, "only-my-pi", "generations", GRAPH_PLAN.generationKey)),
    true,
  );

  const recovering = harness({ transactionIdFactory: transactionIds(261) });
  await assert.rejects(
    recovering.engine.applyGraphPlan(stalePlan, { operation: "bootstrap" }),
    (error) => {
      assert.equal(error?.code, "PLAN_STALE");
      assert.equal(error.recovered?.length, 1);
      assert.equal(error.recovered?.[0].status, "FAILED");
      assert.equal(error.recovered?.[0].settingsDisposition, "PRESERVE_CONCURRENT");
      return true;
    },
  );

  const preserved = await loadSettings(configRoot);
  assert.deepEqual(preserved.settings, { ...initial, concurrentUserField });
  assert.equal(extractManagedMetadata(preserved.settings), null);
  assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
  const [failed] = await listTransactionJournals(configRoot);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failureCode, "CONCURRENT_SETTINGS_CHANGE");
  assert.equal(
    await exists(path.join(configRoot, "only-my-pi", "generations", GRAPH_PLAN.generationKey)),
    false,
  );

  const replanned = await bootstrapPlan(configRoot);
  const committed = await harness({ transactionIdFactory: transactionIds(261) })
    .engine.applyGraphPlan(replanned, { operation: "bootstrap" });
  assert.equal(committed.status, "COMMITTED");
  const final = await loadSettings(configRoot);
  assert.deepEqual(final.settings.concurrentUserField, concurrentUserField);
  assert.deepEqual(extractManagedMetadata(final.settings), installedMetadata());
  await assertNoDanglingSettings(configRoot);
});

test("journal creation failures keep their real error instead of claiming a rollback", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  await saveSettings(configRoot, initialUserSettings());
  const invalidId = harness({ transactionIdFactory: () => "not-a-uuid" });
  const plan = await bootstrapPlan(configRoot);
  await assert.rejects(
    invalidId.engine.applyGraphPlan(plan, { operation: "bootstrap" }),
    (error) => error?.code === "INVALID_TRANSACTION_ID" && error.code !== "TRANSACTION_ROLLED_BACK",
  );
  assert.deepEqual(await listTransactionJournals(configRoot), []);

  const duplicateId = uuid(301);
  await createJournal(configRoot, {
    transactionId: duplicateId,
    operation: "bootstrap",
    profileId: "coding",
    generationId: GRAPH_PLAN.graphDigest,
    snapshotId: `before-${duplicateId}`,
  });
  const duplicate = harness({ transactionIdFactory: () => duplicateId });
  await assert.rejects(
    duplicate.engine.applyGraphPlan(plan, { operation: "bootstrap" }),
    (error) => error?.code === "TRANSACTION_EXISTS" && error.code !== "TRANSACTION_ROLLED_BACK",
  );
  assert.equal((await loadJournal(configRoot, duplicateId)).status, "ROLLED_BACK");
});

test("uninstall preserves unknown settings, rollback restores the installed snapshot, and LKG-clear crash is recoverable", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const initial = initialUserSettings();
  await saveSettings(configRoot, initial);
  const installed = harness({ transactionIdFactory: transactionIds(400) });
  await installed.engine.applyGraphPlan(await bootstrapPlan(configRoot), { operation: "bootstrap" });
  const installedSettings = (await loadSettings(configRoot)).settings;

  const uninstall = harness({ transactionIdFactory: transactionIds(401) });
  const uninstallResult = await uninstall.engine.applyUninstallPlan(await uninstallPlan(configRoot));
  assert.equal(uninstallResult.status, "COMMITTED");
  assert.deepEqual(uninstallResult.resourceDisposition, {
    policy: "RETAIN_IMMUTABLE_FOR_ROLLBACK",
    generationId: GRAPH_PLAN.graphDigest,
    deletionAttempted: false,
  });
  const afterUninstall = await loadSettings(configRoot);
  assert.equal(extractManagedMetadata(afterUninstall.settings), null);
  assert.deepEqual(afterUninstall.settings.editor, initial.editor);
  assert.deepEqual(afterUninstall.settings.unrelated, initial.unrelated);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });
  const uninstallJournal = await loadJournal(configRoot, uninstallResult.transactionId);

  const laterUserPackage = "npm:user-added-after-snapshot@1.0.0";
  await saveSettings(configRoot, {
    ...afterUninstall.settings,
    packages: [...(afterUninstall.settings.packages ?? []), laterUserPackage],
  });

  const rollback = harness({ transactionIdFactory: transactionIds(402) });
  const rollbackResult = await rollback.engine.applyRollbackPlan(
    await rollbackPlan(configRoot, uninstallJournal.snapshotId),
  );
  assert.equal(rollbackResult.status, "COMMITTED");
  const installedWithLaterUser = (await loadSettings(configRoot)).settings;
  assert.deepEqual(installedWithLaterUser.packages, [
    laterUserPackage,
    ...installedSettings.packages,
  ]);
  assert.deepEqual(installedWithLaterUser.editor, installedSettings.editor);
  assert.deepEqual(installedWithLaterUser.unrelated, installedSettings.unrelated);
  assert.deepEqual(extractManagedMetadata(installedWithLaterUser), installedMetadata());
  assert.equal((await readState(configRoot)).transactionId, rollbackResult.transactionId);
  await assertNoDanglingSettings(configRoot);

  const crashUninstallPlan = await uninstallPlan(configRoot);
  const crashed = harness({
    transactionIdFactory: transactionIds(403),
    onBoundary: createCrashBoundary("LAST_KNOWN_GOOD_CLEARED"),
  });
  await assert.rejects(
    crashed.engine.applyUninstallPlan(crashUninstallPlan),
    (error) => error?.code === "SIMULATED_PROCESS_CRASH",
  );
  assert.equal(extractManagedMetadata((await loadSettings(configRoot)).settings), null);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });

  const apparentNoChange = await uninstallPlan(configRoot);
  assert.equal(apparentNoChange.status, "NO_CHANGES");
  const recovered = await harness({ transactionIdFactory: transactionIds(404) })
    .engine.applyUninstallPlan(apparentNoChange);
  assert.equal(recovered.status, "RECOVERED_REPLAN_REQUIRED");
  assert.deepEqual((await loadSettings(configRoot)).settings, installedWithLaterUser);
  assert.equal((await readState(configRoot)).generationId, GRAPH_PLAN.graphDigest);

  const finalUninstall = await harness({ transactionIdFactory: transactionIds(404) })
    .engine.applyUninstallPlan(await uninstallPlan(configRoot));
  assert.equal(finalUninstall.status, "COMMITTED");
  assert.equal(extractManagedMetadata((await loadSettings(configRoot)).settings), null);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });
  assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
});

test("rollback of a first installation restores an originally absent settings file", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  assert.equal((await loadSettings(configRoot)).exists, false);
  const installed = harness({ transactionIdFactory: transactionIds(500) });
  const result = await installed.engine.applyGraphPlan(await bootstrapPlan(configRoot), { operation: "bootstrap" });
  const journal = await loadJournal(configRoot, result.transactionId);
  const before = await loadOwnedSettingsSnapshot(configRoot, journal.snapshotId);
  assert.equal(before.source.exists, false);
  assert.equal(before.source.digest, ABSENT_SETTINGS_DIGEST);

  const currentGeneration = path.join(configRoot, "only-my-pi", "generations", GRAPH_PLAN.generationKey);
  await fs.rm(currentGeneration, { recursive: true, force: false });

  const rolledBack = await harness({ transactionIdFactory: transactionIds(501) })
    .engine.applyRollbackPlan(await rollbackPlan(configRoot, journal.snapshotId));
  assert.equal(rolledBack.status, "COMMITTED");
  const current = await loadSettings(configRoot);
  assert.equal(current.exists, false);
  assert.equal(current.digest, ABSENT_SETTINGS_DIGEST);
  assert.equal(await exists(path.join(configRoot, "settings.json")), false);
  const rollbackJournal = await loadJournal(configRoot, rolledBack.transactionId);
  assert.equal(rollbackJournal.generationId, null);
  assert.equal(rollbackJournal.intendedSettingsDigest, ABSENT_SETTINGS_DIGEST);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });
});

test("uninstall removes owned references even when the current generation is missing", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const initial = initialUserSettings();
  await saveSettings(configRoot, initial);
  const installed = harness({ transactionIdFactory: transactionIds(550) });
  await installed.engine.applyGraphPlan(await bootstrapPlan(configRoot), { operation: "bootstrap" });

  const generationRoot = path.join(configRoot, "only-my-pi", "generations", GRAPH_PLAN.generationKey);
  await fs.rm(generationRoot, { recursive: true, force: false });
  const uninstall = harness({ transactionIdFactory: transactionIds(551) });
  const result = await uninstall.engine.applyUninstallPlan(await uninstallPlan(configRoot));

  assert.equal(result.status, "COMMITTED");
  assert.deepEqual(result.resourceDisposition, {
    policy: "RETAIN_IMMUTABLE_FOR_ROLLBACK",
    generationId: GRAPH_PLAN.graphDigest,
    deletionAttempted: false,
  });
  const current = await loadSettings(configRoot);
  assert.equal(extractManagedMetadata(current.settings), null);
  assert.deepEqual(current.settings.editor, initial.editor);
  assert.deepEqual(current.settings.unrelated, initial.unrelated);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });
});

test("settings-only publication CAS preserves a concurrent write before uninstall and permits replan", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  await saveSettings(configRoot, initialUserSettings());
  await harness({ transactionIdFactory: transactionIds(575) })
    .engine.applyGraphPlan(await bootstrapPlan(configRoot), { operation: "bootstrap" });
  const stalePlan = await uninstallPlan(configRoot);
  const concurrentUserField = { preserve: true, writer: "external-uninstall" };
  let injected = false;
  const raced = harness({
    transactionIdFactory: transactionIds(576),
    onBoundary: async (name) => {
      if (name !== "GRAPH_PROMOTED" || injected) return;
      injected = true;
      const observed = await loadSettings(configRoot);
      await saveSettings(configRoot, {
        ...observed.settings,
        concurrentUserField,
      });
    },
  });

  await assert.rejects(
    raced.engine.applyUninstallPlan(stalePlan),
    (error) => {
      assert.equal(error?.code, "CONCURRENT_SETTINGS_CHANGE");
      assert.equal(error.atomicPublication, "NOT_PUBLISHED");
      assert.equal(error.recovery?.status, "FAILED");
      assert.equal(error.recovery?.settingsDisposition, "PRESERVE_CONCURRENT");
      return true;
    },
  );

  const preserved = await loadSettings(configRoot);
  assert.deepEqual(preserved.settings.concurrentUserField, concurrentUserField);
  assert.deepEqual(extractManagedMetadata(preserved.settings), installedMetadata());
  assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
  const racedJournal = (await listTransactionJournals(configRoot))
    .find((journal) => journal.transactionId === uuid(576));
  assert.equal(racedJournal.status, "FAILED");
  assert.equal(racedJournal.failureCode, "CONCURRENT_SETTINGS_CHANGE");

  const replanned = await uninstallPlan(configRoot);
  assert.notEqual(replanned.sourceSettings.digest, stalePlan.sourceSettings.digest);
  const committed = await harness({ transactionIdFactory: transactionIds(577) })
    .engine.applyUninstallPlan(replanned);
  assert.equal(committed.status, "COMMITTED");
  const final = await loadSettings(configRoot);
  assert.deepEqual(final.settings.concurrentUserField, concurrentUserField);
  assert.equal(extractManagedMetadata(final.settings), null);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });
});

test("apply and rollback use one exclusive config lock", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  await saveSettings(configRoot, initialUserSettings());
  const first = harness({ transactionIdFactory: transactionIds(600) });
  const installed = await first.engine.applyGraphPlan(await bootstrapPlan(configRoot), { operation: "bootstrap" });
  const firstJournal = await loadJournal(configRoot, installed.transactionId);
  const updatePlan = await bootstrapPlan(configRoot, { kind: "only-my-pi-update-plan", operation: "update" });
  const competingRollback = await rollbackPlan(configRoot, firstJournal.snapshotId);

  let releaseStage;
  const stageGate = new Promise((resolve) => { releaseStage = resolve; });
  let stageEntered;
  const entered = new Promise((resolve) => { stageEntered = resolve; });
  const update = harness({
    transactionIdFactory: transactionIds(601),
    controls: { stageGate, onStageEntered: stageEntered },
  });
  const updatePromise = update.engine.applyGraphPlan(updatePlan, { operation: "update" });
  await entered;
  const rollback = harness({ transactionIdFactory: transactionIds(602) });
  await assert.rejects(
    rollback.engine.applyRollbackPlan(competingRollback),
    (error) => error?.code === "LOCK_HELD" && error.status === "OWNED",
  );
  releaseStage();
  assert.equal((await updatePromise).status, "COMMITTED");
  assert.equal((await listTransactionJournals(configRoot, { incompleteOnly: true })).length, 0);
  await assertNoDanglingSettings(configRoot);
});

test("a missing or stale committed LKG is truthfully reported as repaired by the next locked no-op apply", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  await saveSettings(configRoot, initialUserSettings());
  const first = harness({ transactionIdFactory: transactionIds(700) });
  await first.engine.applyGraphPlan(await bootstrapPlan(configRoot), { operation: "bootstrap" });
  const statePath = path.join(configRoot, "only-my-pi", "state", "last-known-good.json");
  await fs.rm(statePath);
  await assert.rejects(readState(configRoot), { code: "ENOENT" });

  const repair = harness({ transactionIdFactory: transactionIds(701) });
  const noChange = await bootstrapPlan(configRoot, { status: "NO_CHANGES" });
  const result = await repair.engine.applyGraphPlan(noChange, { operation: "bootstrap" });
  assert.equal(result.status, "REPAIRED_NO_CHANGES");
  assert.equal(result.mutation, true);
  assert.equal(result.reconciledLastKnownGood.status, "REBUILT");
  assert.equal((await readState(configRoot)).generationId, GRAPH_PLAN.graphDigest);
  assert.equal(repair.stats.runnerCalls, 0);
  assert.equal(repair.stats.smokeCalls, 0);
  assert.equal(await exists(path.join(configRoot, "auth.json")), false);

  const stale = JSON.parse(await fs.readFile(statePath, "utf8"));
  stale.settingsDigest = `sha256:${"f".repeat(64)}`;
  delete stale.digest;
  stale.digest = sha256(canonicalJson(stale));
  await fs.writeFile(statePath, `${canonicalJson(stale)}\n`);
  const staleRepair = harness({ transactionIdFactory: transactionIds(702) });
  const staleResult = await staleRepair.engine.applyGraphPlan(
    await bootstrapPlan(configRoot, { status: "NO_CHANGES" }),
    { operation: "bootstrap" },
  );
  assert.equal(staleResult.status, "REPAIRED_NO_CHANGES");
  assert.equal(staleResult.mutation, true);
  assert.equal(staleResult.reconciledLastKnownGood.status, "REBUILT");
  assert.equal((await verifyLastKnownGood(configRoot)).ok, true);
  assert.equal(staleRepair.stats.runnerCalls, 0);
  assert.equal(staleRepair.stats.smokeCalls, 0);
});
