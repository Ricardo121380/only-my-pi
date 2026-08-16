import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  ABSENT_SETTINGS_DIGEST,
  TRANSACTION_PHASES,
  acquireExclusiveLock,
  advanceJournal,
  assertSafeContainedPath,
  atomicWriteJson,
  atomicWriteText,
  beginTransactionRecovery,
  compareAndRemoveSettings,
  compareAndSaveSettings,
  createConfigPaths,
  createJournal,
  createSnapshot,
  hashFile,
  inspectConfigLock,
  listTransactionJournals,
  loadJournal,
  loadSettings,
  mergeOwnedSettings,
  planTransactionRecovery,
  readState,
  removeOwnedSettings,
  restoreLastKnownGood,
  restoreSnapshot,
  saveSettings,
  settleTransactionRecovery,
  settingsDigest,
  verifyLastKnownGood,
  verifyOwnedSettingsSnapshot,
  verifyTransactionRecoveryEvidence,
  writeState,
} from "../packages/config-runtime/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function isolatedRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-config-runtime-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function assertSchemaValid(schemaName, document) {
  const schema = await readJson(path.join(repoRoot, "schemas", schemaName));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
}

test("config paths require an explicit absolute root and remain contained", async (t) => {
  const root = await isolatedRoot(t);
  const paths = createConfigPaths(root);
  assert.equal(paths.settingsFile, path.join(root, "settings.json"));
  assert.equal(paths.generationsRoot, path.join(root, "only-my-pi", "generations"));
  assert.throws(() => createConfigPaths("relative/root"), { code: "CONFIG_ROOT_NOT_ABSOLUTE" });
  assert.throws(() => createConfigPaths(""), { code: "CONFIG_ROOT_REQUIRED" });
  await assert.rejects(atomicWriteText(root, "../escape", "no"), /path traversal|non-canonical/);
  await assert.rejects(atomicWriteText(root, "/tmp/escape", "no"), /escapes configRoot|path traversal/);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-config-outside-"));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, "escape"));
  await assert.rejects(
    atomicWriteText(root, "escape/payload.json", "{}\n"),
    (error) => error.code === "SYMLINK_ESCAPE",
  );
  await assert.rejects(
    assertSafeContainedPath(root, path.join(root, "escape", "payload.json")),
    (error) => error.code === "SYMLINK_ESCAPE",
  );
  await assert.rejects(fs.lstat(path.join(outside, "payload.json")), { code: "ENOENT" });
  await fs.writeFile(path.join(outside, "settings.json"), "{}\n");
  await fs.symlink(path.join(outside, "settings.json"), path.join(root, "settings.json"));
  await assert.rejects(loadSettings(root), (error) => error.code === "SYMLINK_ESCAPE");
});

test("atomic publication preserves the old file when interrupted before rename", async (t) => {
  const root = await isolatedRoot(t);
  const target = path.join(root, "settings.json");
  await atomicWriteText(root, target, "old\n");
  await assert.rejects(
    atomicWriteText(root, target, "new\n", { failAtPhase: "BEFORE_RENAME" }),
    (error) => error.code === "INJECTED_ATOMIC_WRITE_FAILURE" && error.atomicPublication === "NOT_PUBLISHED",
  );
  assert.equal(await fs.readFile(target, "utf8"), "old\n");
  assert.deepEqual((await fs.readdir(path.dirname(target))).filter((name) => name.endsWith(".tmp")), []);

  const phases = [];
  await atomicWriteJson(root, target, { b: 2, a: 1 }, { onPhase: (phase) => phases.push(phase) });
  assert.deepEqual(await readJson(target), { a: 1, b: 2 });
  assert.ok(phases.includes("AFTER_FILE_SYNC"));
  assert.ok(phases.includes("AFTER_DIRECTORY_SYNC"));
});

test("settings loader fails closed for blank and malformed files but accepts fresh and empty objects", async (t) => {
  const root = await isolatedRoot(t);
  const paths = createConfigPaths(root);
  const missing = await loadSettings(root);
  assert.equal(missing.exists, false);
  assert.equal(missing.digest, ABSENT_SETTINGS_DIGEST);
  assert.deepEqual(missing.settings, {});

  await atomicWriteText(root, paths.settingsFile, "\n");
  await assert.rejects(loadSettings(root), (error) => error.code === "EMPTY_SETTINGS");
  await atomicWriteText(root, paths.settingsFile, "{not-json}\n");
  await assert.rejects(loadSettings(root), (error) => error.code === "MALFORMED_SETTINGS");
  await atomicWriteText(root, paths.settingsFile, "{}\n");
  const emptyObject = await loadSettings(root);
  assert.equal(emptyObject.exists, true);
  assert.deepEqual(emptyObject.settings, {});
});

test("settings compare-and-publish preserves a concurrent canonical state without publication", async (t) => {
  const root = await isolatedRoot(t);
  const paths = createConfigPaths(root);
  const initial = await saveSettings(root, {
    editor: { theme: "before" },
    unknown: { preserve: true },
  });
  const concurrent = {
    editor: { theme: "before" },
    unknown: { preserve: true },
    concurrentUserField: { mustSurvive: true },
  };

  await assert.rejects(
    compareAndSaveSettings(
      root,
      { editor: { theme: "managed" }, unknown: { preserve: true } },
      {
        expectedCurrent: { exists: initial.exists, digest: initial.digest },
        atomic: {
          beforeRename: async () => saveSettings(root, concurrent),
        },
      },
    ),
    (error) => error.code === "CONCURRENT_SETTINGS_CHANGE"
      && error.atomicPublication === "NOT_PUBLISHED"
      && error.expected.digest === initial.digest
      && error.actual.digest === settingsDigest(concurrent),
  );
  assert.deepEqual((await loadSettings(root)).settings, concurrent);
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.endsWith(".tmp")),
    [],
  );

  const current = await loadSettings(root);
  await assert.rejects(
    compareAndRemoveSettings(root, {
      expectedCurrent: { exists: current.exists, digest: current.digest },
      atomic: {
        beforeRemoveRename: async () => saveSettings(root, {
          ...concurrent,
          secondConcurrentChange: true,
        }),
      },
    }),
    (error) => error.code === "CONCURRENT_SETTINGS_CHANGE"
      && error.atomicPublication === "NOT_PUBLISHED",
  );
  assert.equal((await loadSettings(root)).settings.secondConcurrentChange, true);

  const removable = await loadSettings(root);
  const removed = await compareAndRemoveSettings(root, {
    expectedCurrent: { exists: removable.exists, digest: removable.digest },
  });
  assert.equal(removed.exists, false);
  assert.equal(removed.removed, true);
  assert.equal((await loadSettings(root)).digest, ABSENT_SETTINGS_DIGEST);

  const created = await compareAndSaveSettings(root, { unknown: { stillPreserved: true } }, {
    expectedCurrent: { exists: false, digest: ABSENT_SETTINGS_DIGEST },
  });
  assert.equal(created.exists, true);
  assert.deepEqual((await loadSettings(root)).settings, { unknown: { stillPreserved: true } });
  await assert.rejects(
    compareAndSaveSettings(root, { no: "write" }, {
      expectedCurrent: { exists: false, digest: ABSENT_SETTINGS_DIGEST },
    }),
    (error) => error.code === "CONCURRENT_SETTINGS_CHANGE" && error.atomicPublication === "NOT_PUBLISHED",
  );
  await assert.rejects(
    compareAndRemoveSettings(root, {
      expectedCurrent: { exists: false, digest: ABSENT_SETTINGS_DIGEST },
    }),
    (error) => error.code === "CONCURRENT_SETTINGS_CHANGE"
      && error.atomicPublication === "NOT_PUBLISHED",
  );
  assert.deepEqual(await readJson(paths.settingsFile), { unknown: { stillPreserved: true } });
});

test("owned settings updates and removal preserve all unowned fields", () => {
  const existing = {
    editor: { theme: "user-theme", fontSize: 15 },
    pi: { extensions: ["old"], userOption: true },
    unrelated: [1, 2, 3],
  };
  const desired = { pi: { extensions: ["generation/extensions"] }, omp: { generation: "g-1" } };
  const owned = ["/pi/extensions", "/omp"];
  const merged = mergeOwnedSettings(existing, desired, owned);
  assert.deepEqual(merged, {
    editor: { theme: "user-theme", fontSize: 15 },
    pi: { extensions: ["generation/extensions"], userOption: true },
    unrelated: [1, 2, 3],
    omp: { generation: "g-1" },
  });
  assert.deepEqual(existing.pi.extensions, ["old"], "merge must not mutate the caller");
  assert.deepEqual(removeOwnedSettings(merged, owned), {
    editor: { theme: "user-theme", fontSize: 15 },
    pi: { userOption: true },
    unrelated: [1, 2, 3],
  });
  assert.throws(
    () => mergeOwnedSettings(existing, desired, ["/pi", "/pi/extensions"]),
    /overlapping owned paths/,
  );
  const unusualUnknownField = JSON.parse('{"__proto__":{"preserved":true},"pi":{"extensions":["old"]}}');
  const unusualMerged = mergeOwnedSettings(
    unusualUnknownField,
    { pi: { extensions: ["new"] } },
    ["/pi/extensions"],
  );
  assert.equal(Object.hasOwn(unusualMerged, "__proto__"), true);
  assert.deepEqual(unusualMerged.__proto__, { preserved: true });
  assert.equal({}.preserved, undefined, "unknown JSON keys must never pollute object prototypes");
});

test("apply and rollback contenders share one exclusive lock", async (t) => {
  const root = await isolatedRoot(t);
  const contenders = await Promise.allSettled([
    acquireExclusiveLock(root, { operation: "apply", ownerToken: "apply-owner-token-0001" }),
    acquireExclusiveLock(root, { operation: "rollback", ownerToken: "rollback-owner-token-01" }),
  ]);
  assert.equal(contenders.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(contenders.filter((entry) => entry.status === "rejected").length, 1);
  const rejection = contenders.find((entry) => entry.status === "rejected").reason;
  assert.equal(rejection.code, "LOCK_HELD");
  const winner = contenders.find((entry) => entry.status === "fulfilled").value;
  const inspection = await inspectConfigLock(root);
  assert.equal(inspection.status, "OWNED");
  assert.equal(inspection.owner.operation, winner.operation);
  await winner.release();
  assert.equal((await inspectConfigLock(root)).status, "FREE");
});

test("a provably dead stale lock can be reclaimed without letting the old owner release the new lock", async (t) => {
  const root = await isolatedRoot(t);
  const oldNow = () => new Date("2026-01-01T00:00:00.000Z");
  const oldLock = await acquireExclusiveLock(root, {
    operation: "apply",
    ownerToken: "stale-owner-token-00001",
    pid: 999_999,
    now: oldNow,
  });
  const replacement = await acquireExclusiveLock(root, {
    operation: "rollback",
    ownerToken: "fresh-owner-token-00001",
    staleAfterMs: 1_000,
    now: () => new Date("2026-01-01T00:10:00.000Z"),
    isOwnerAlive: async () => false,
  });
  assert.equal(replacement.operation, "rollback");
  await assert.rejects(oldLock.release(), (error) => error.code === "LOCK_OWNERSHIP_LOST");
  await replacement.release();
});

test("a crashed lock initializer leaves only an ignorable sibling and never a visible partial lock", async (t) => {
  const root = await isolatedRoot(t);
  const paths = createConfigPaths(root);
  await fs.mkdir(paths.locksRoot, { recursive: true });
  const orphan = `.only-my-pi-dir-999-${"a".repeat(32)}.tmp`;
  await fs.mkdir(path.join(paths.locksRoot, orphan));
  assert.equal((await inspectConfigLock(root)).status, "FREE");

  await assert.rejects(
    acquireExclusiveLock(root, {
      operation: "apply",
      ownerToken: "failed-owner-token-0001",
      directoryAtomic: { failAtPhase: "BEFORE_DIRECTORY_RENAME" },
    }),
    (error) => error.code === "INJECTED_ATOMIC_DIRECTORY_FAILURE"
      && error.atomicPublication === "NOT_PUBLISHED",
  );
  assert.equal((await inspectConfigLock(root)).status, "FREE");
  assert.deepEqual((await fs.readdir(paths.locksRoot)).sort(), [orphan]);

  const lock = await acquireExclusiveLock(root, {
    operation: "rollback",
    ownerToken: "complete-owner-token-001",
  });
  assert.equal((await inspectConfigLock(root)).status, "OWNED");
  assert.equal(await readJson(path.join(paths.configurationLock, "owner.json")).then((owner) => owner.token), lock.token);
  await lock.release();
  assert.deepEqual((await fs.readdir(paths.locksRoot)).sort(), [orphan]);
});

test("transaction journal permits only durable contiguous phase transitions", async (t) => {
  const root = await isolatedRoot(t);
  const transactionId = "11111111-1111-4111-8111-111111111111";
  let journal = await createJournal(root, {
    transactionId,
    operation: "bootstrap",
    profileId: "coding",
    generationId: `sha256:${"1".repeat(64)}`,
    snapshotId: "before-apply",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(journal.phase, "PREPARED");
  await assert.rejects(
    advanceJournal(root, journal.transactionId, "GRAPH_STAGED"),
    (error) => error.code === "INVALID_JOURNAL_TRANSITION",
  );
  assert.equal((await loadJournal(root, journal.transactionId)).phase, "PREPARED");

  const generationManifestDigest = `sha256:${"4".repeat(64)}`;
  const intendedSettingsDigest = `sha256:${"5".repeat(64)}`;
  for (const phase of TRANSACTION_PHASES.slice(1, 7)) {
    const evidence = phase === "GRAPH_VERIFIED"
      ? { generationManifestDigest }
      : phase === "GRAPH_PROMOTED"
        ? { intendedSettingsDigest, promotionCreated: true }
        : undefined;
    journal = await advanceJournal(root, journal.transactionId, phase, {
      expectedPhase: journal.phase,
      ...(evidence ? { evidence } : {}),
    });
  }
  assert.equal(journal.phase, "SETTINGS_PUBLISHED");
  assert.deepEqual(planTransactionRecovery(journal), {
    transactionId: journal.transactionId,
    operation: "bootstrap",
    status: "ACTIVE",
    phase: "SETTINGS_PUBLISHED",
    required: true,
    action: "COMPARE_SETTINGS_AND_RECOVER",
    requiresRollbackLock: true,
    generationManifestDigest,
    promotionCreated: true,
    intendedSettingsDigest,
  });
  const incomplete = await listTransactionJournals(root, { incompleteOnly: true });
  assert.deepEqual(incomplete.map((entry) => entry.transactionId), [journal.transactionId]);

  await assert.rejects(
    advanceJournal(root, journal.transactionId, "STATIC_DOCTOR_PASSED", { atomic: { failAtPhase: "BEFORE_RENAME" } }),
    (error) => error.code === "INJECTED_ATOMIC_WRITE_FAILURE",
  );
  assert.equal((await loadJournal(root, journal.transactionId)).phase, "SETTINGS_PUBLISHED");

  for (const phase of TRANSACTION_PHASES.slice(7)) {
    journal = await advanceJournal(root, journal.transactionId, phase, { expectedPhase: journal.phase });
  }
  assert.equal(planTransactionRecovery(journal).action, "NONE");
  assert.deepEqual(await listTransactionJournals(root, { incompleteOnly: true }), []);
});

test("transaction publication ignores crashed temporary siblings and never exposes a partial journal", async (t) => {
  const root = await isolatedRoot(t);
  const paths = createConfigPaths(root);
  await fs.mkdir(paths.transactionsRoot, { recursive: true });
  const orphan = `.only-my-pi-dir-999-${"b".repeat(32)}.tmp`;
  await fs.mkdir(path.join(paths.transactionsRoot, orphan));
  await fs.writeFile(path.join(paths.transactionsRoot, orphan, "incomplete"), "not-a-journal\n");
  assert.deepEqual(await listTransactionJournals(root), []);

  const transactionId = "88888888-8888-4888-8888-888888888888";
  const journal = await createJournal(root, {
    transactionId,
    operation: "bootstrap",
    profileId: "coding",
    generationId: `sha256:${"8".repeat(64)}`,
    snapshotId: "atomic-journal",
  });
  assert.equal((await loadJournal(root, transactionId)).transactionId, journal.transactionId);
  assert.deepEqual((await listTransactionJournals(root)).map((entry) => entry.transactionId), [transactionId]);

  const failedId = "99999999-9999-4999-8999-999999999999";
  await assert.rejects(
    createJournal(root, {
      transactionId: failedId,
      operation: "bootstrap",
      profileId: "coding",
      generationId: `sha256:${"9".repeat(64)}`,
      snapshotId: "failed-journal",
      directoryAtomic: { failAtPhase: "BEFORE_DIRECTORY_RENAME" },
    }),
    (error) => error.code === "INJECTED_ATOMIC_DIRECTORY_FAILURE"
      && error.atomicPublication === "NOT_PUBLISHED",
  );
  await assert.rejects(fs.lstat(path.join(paths.transactionsRoot, failedId)), { code: "ENOENT" });
  assert.deepEqual((await fs.readdir(paths.transactionsRoot)).sort(), [orphan, transactionId].sort());
});

test("recovery settles an incomplete journal without fabricating normal phases", async (t) => {
  const root = await isolatedRoot(t);
  const transactionId = "22222222-2222-4222-8222-222222222222";
  const created = await createJournal(root, {
    transactionId,
    operation: "update",
    profileId: "coding",
    generationId: `sha256:${"2".repeat(64)}`,
    snapshotId: "update-backup",
  });
  const recovering = await beginTransactionRecovery(root, transactionId);
  assert.equal(recovering.status, "RECOVERING");
  assert.deepEqual(recovering.phaseHistory, ["PREPARED"]);
  const settled = await settleTransactionRecovery(root, transactionId, "ROLLED_BACK", {
    failureCode: "RECOVERY_TEST",
  });
  assert.equal(settled.status, "ROLLED_BACK");
  assert.equal(settled.phase, created.phase);
  assert.deepEqual(settled.phaseHistory, ["PREPARED"]);
  assert.equal(planTransactionRecovery(settled).required, false);
  await assert.rejects(
    advanceJournal(root, transactionId, "BACKUP_DURABLE"),
    (error) => error.code === "JOURNAL_NOT_ACTIVE",
  );
});

test("reused promotion receipt closes the settings rename crash window without claiming creation", async (t) => {
  const root = await isolatedRoot(t);
  const transactionId = "33333333-3333-4333-8333-333333333333";
  let journal = await createJournal(root, {
    transactionId,
    operation: "update",
    profileId: "coding",
    generationId: `sha256:${"6".repeat(64)}`,
    snapshotId: "crash-window",
  });
  const manifestDigest = `sha256:${"7".repeat(64)}`;
  const beforeDigest = `sha256:${"8".repeat(64)}`;
  const intendedDigest = `sha256:${"9".repeat(64)}`;
  for (const phase of TRANSACTION_PHASES.slice(1, 5)) {
    const evidence = phase === "GRAPH_VERIFIED" ? { generationManifestDigest: manifestDigest } : undefined;
    journal = await advanceJournal(root, transactionId, phase, evidence ? { evidence } : {});
  }
  journal = await advanceJournal(root, transactionId, "GRAPH_PROMOTED", {
    evidence: { promotionCreated: false, intendedSettingsDigest: intendedDigest },
  });
  assert.equal(journal.settingsPublished, false);
  assert.equal(journal.promotionCreated, false);
  assert.equal(journal.intendedSettingsDigest, intendedDigest);
  assert.equal(
    verifyTransactionRecoveryEvidence(journal, {
      currentSettingsDigest: beforeDigest,
      snapshotSourceDigest: beforeDigest,
    }).settingsDisposition,
    "SETTINGS_UNCHANGED",
  );
  assert.equal(
    verifyTransactionRecoveryEvidence(journal, {
      currentSettingsDigest: intendedDigest,
      snapshotSourceDigest: beforeDigest,
    }).settingsDisposition,
    "RESTORE_SNAPSHOT",
  );
  await assert.rejects(
    beginTransactionRecovery(root, transactionId, {
      evidence: {
        currentSettingsDigest: `sha256:${"a".repeat(64)}`,
        snapshotSourceDigest: beforeDigest,
      },
    }),
    (error) => error.code === "RECOVERY_SETTINGS_CAS_MISMATCH",
  );
  const recovering = await beginTransactionRecovery(root, transactionId, {
    evidence: { currentSettingsDigest: intendedDigest, snapshotSourceDigest: beforeDigest },
  });
  assert.equal(recovering.status, "RECOVERING");
});

test("a pre-publication third settings digest can be preserved without masking a known rename", async (t) => {
  const root = await isolatedRoot(t);
  const transactionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let journal = await createJournal(root, {
    transactionId,
    operation: "update",
    profileId: "coding",
    generationId: `sha256:${"a".repeat(64)}`,
    snapshotId: "unpublished-cas",
  });
  const manifestDigest = `sha256:${"b".repeat(64)}`;
  const beforeDigest = `sha256:${"c".repeat(64)}`;
  const intendedDigest = `sha256:${"d".repeat(64)}`;
  const concurrentDigest = `sha256:${"e".repeat(64)}`;
  for (const phase of TRANSACTION_PHASES.slice(1, 5)) {
    const evidence = phase === "GRAPH_VERIFIED" ? { generationManifestDigest: manifestDigest } : undefined;
    journal = await advanceJournal(root, transactionId, phase, evidence ? { evidence } : {});
  }
  journal = await advanceJournal(root, transactionId, "GRAPH_PROMOTED", {
    evidence: { promotionCreated: true, intendedSettingsDigest: intendedDigest },
  });

  await assert.rejects(
    beginTransactionRecovery(root, transactionId, {
      evidence: {
        currentSettingsDigest: concurrentDigest,
        snapshotSourceDigest: beforeDigest,
      },
    }),
    (error) => error.code === "RECOVERY_SETTINGS_CAS_MISMATCH",
  );
  assert.equal(
    verifyTransactionRecoveryEvidence(journal, {
      currentSettingsDigest: intendedDigest,
      snapshotSourceDigest: beforeDigest,
      preserveConcurrentSettings: true,
    }).settingsDisposition,
    "RESTORE_SNAPSHOT",
  );
  const evidence = verifyTransactionRecoveryEvidence(journal, {
    currentSettingsDigest: concurrentDigest,
    snapshotSourceDigest: beforeDigest,
    preserveConcurrentSettings: true,
  });
  assert.equal(evidence.settingsDisposition, "PRESERVE_CONCURRENT");
  assert.equal(evidence.preserveConcurrentSettings, true);

  const publishedJournal = {
    ...journal,
    phase: "SETTINGS_PUBLISHED",
    phaseHistory: [...journal.phaseHistory, "SETTINGS_PUBLISHED"],
    settingsPublished: true,
  };
  await assert.rejects(
    Promise.resolve().then(() => verifyTransactionRecoveryEvidence(publishedJournal, {
      currentSettingsDigest: concurrentDigest,
      snapshotSourceDigest: beforeDigest,
      preserveConcurrentSettings: true,
    })),
    (error) => error.code === "RECOVERY_CONCURRENT_PRESERVATION_INVALID",
  );

  const recovering = await beginTransactionRecovery(root, transactionId, {
    evidence: {
      currentSettingsDigest: concurrentDigest,
      snapshotSourceDigest: beforeDigest,
      preserveConcurrentSettings: true,
    },
  });
  assert.equal(recovering.status, "RECOVERING");
  const settled = await settleTransactionRecovery(root, transactionId, "ROLLED_BACK", {
    failureCode: "CONCURRENT_SETTINGS_CHANGE",
  });
  assert.equal(settled.status, "ROLLED_BACK");
});

test("uninstall journal uses null generation receipts without a fake target generation", async (t) => {
  const root = await isolatedRoot(t);
  const transactionId = "44444444-4444-4444-8444-444444444444";
  let journal = await createJournal(root, {
    transactionId,
    operation: "uninstall",
    profileId: "coding",
    generationId: null,
    snapshotId: "before-uninstall",
  });
  for (const phase of TRANSACTION_PHASES.slice(1, 5)) {
    const evidence = phase === "GRAPH_VERIFIED" ? { generationManifestDigest: null } : undefined;
    journal = await advanceJournal(root, transactionId, phase, evidence ? { evidence } : {});
  }
  journal = await advanceJournal(root, transactionId, "GRAPH_PROMOTED", {
    evidence: { promotionCreated: false, intendedSettingsDigest: `sha256:${"b".repeat(64)}` },
  });
  assert.equal(journal.generationId, null);
  assert.equal(journal.generationManifestDigest, null);
  assert.equal(journal.promotionCreated, false);

  const rollbackId = "66666666-6666-4666-8666-666666666666";
  let rollback = await createJournal(root, {
    transactionId: rollbackId,
    operation: "rollback",
    profileId: "coding",
    generationId: null,
    snapshotId: "pre-first-install",
  });
  for (const phase of TRANSACTION_PHASES.slice(1, 5)) {
    const evidence = phase === "GRAPH_VERIFIED" ? { generationManifestDigest: null } : undefined;
    rollback = await advanceJournal(root, rollbackId, phase, evidence ? { evidence } : {});
  }
  rollback = await advanceJournal(root, rollbackId, "GRAPH_PROMOTED", {
    evidence: { promotionCreated: false, intendedSettingsDigest: ABSENT_SETTINGS_DIGEST },
  });
  assert.equal(rollback.generationId, null);
  assert.equal(rollback.intendedSettingsDigest, ABSENT_SETTINGS_DIGEST);
});

test("owned snapshot rollback is hash-gated and preserves unowned fields", async (t) => {
  const root = await isolatedRoot(t);
  const original = {
    user: { theme: "night", custom: true },
    pi: { extensions: ["old"], userOption: "keep" },
    omp: { generation: "g-old" },
  };
  await saveSettings(root, original);
  const snapshot = await createSnapshot(root, {
    id: "before-apply",
    ownedPaths: ["/pi/extensions", "/omp"],
  });
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "$schema",
    "createdAt",
    "digest",
    "formatVersion",
    "owned",
    "settingsRelativePath",
    "snapshotId",
    "source",
  ]);
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(Object.hasOwn(snapshot, "schemaVersion"), false);
  assert.equal((await verifyOwnedSettingsSnapshot(root, snapshot.snapshotId)).ok, true);

  const published = {
    user: { theme: "dawn", custom: true },
    pi: { extensions: ["new"], userOption: "keep" },
    omp: { generation: "g-new" },
  };
  const current = await saveSettings(root, published);
  await assert.rejects(
    restoreSnapshot(root, snapshot.snapshotId, { expectedCurrentDigest: settingsDigest({ wrong: true }) }),
    (error) => error.code === "ROLLBACK_HASH_MISMATCH",
  );
  assert.deepEqual((await loadSettings(root)).settings, published);
  await assert.rejects(
    restoreSnapshot(root, snapshot.snapshotId, {
      expectedCurrentDigest: current.digest,
      expectedOwnedPaths: ["/omp"],
    }),
    (error) => error.code === "ROLLBACK_OWNERSHIP_MISMATCH",
  );

  const restored = await restoreSnapshot(root, snapshot.snapshotId, {
    expectedCurrentDigest: current.digest,
    expectedOwnedPaths: ["/pi/extensions", "/omp"],
  });
  assert.equal(restored.sourceDigestMatched, false, "an unowned user change intentionally survives");
  assert.deepEqual(restored.settings, {
    user: { theme: "dawn", custom: true },
    pi: { extensions: ["old"], userOption: "keep" },
    omp: { generation: "g-old" },
  });
});

test("snapshot publication ignores crashed temporary siblings and never exposes a partial manifest", async (t) => {
  const root = await isolatedRoot(t);
  const paths = createConfigPaths(root);
  await saveSettings(root, { pi: { extensions: ["user"] }, unknown: true });
  await fs.mkdir(paths.snapshotsRoot, { recursive: true });
  const orphan = `.only-my-pi-dir-999-${"f".repeat(32)}.tmp`;
  await fs.mkdir(path.join(paths.snapshotsRoot, orphan));

  await assert.rejects(
    createSnapshot(root, {
      id: "atomic-snapshot",
      ownedPaths: ["/pi/extensions"],
      directoryAtomic: { failAtPhase: "BEFORE_DIRECTORY_RENAME" },
    }),
    (error) => error.code === "INJECTED_ATOMIC_DIRECTORY_FAILURE"
      && error.atomicPublication === "NOT_PUBLISHED",
  );
  await assert.rejects(
    fs.lstat(path.join(paths.snapshotsRoot, "atomic-snapshot")),
    { code: "ENOENT" },
  );
  assert.deepEqual((await fs.readdir(paths.snapshotsRoot)).sort(), [orphan]);

  const snapshot = await createSnapshot(root, {
    id: "atomic-snapshot",
    ownedPaths: ["/pi/extensions"],
  });
  assert.equal((await verifyOwnedSettingsSnapshot(root, snapshot.snapshotId)).ok, true);
  assert.deepEqual((await fs.readdir(paths.snapshotsRoot)).sort(), [orphan, "atomic-snapshot"].sort());
});

test("first-install rollback restores an originally absent settings file", async (t) => {
  const root = await isolatedRoot(t);
  const snapshot = await createSnapshot(root, {
    id: "fresh-install",
    ownedPaths: ["/pi/extensions", "/omp"],
  });
  assert.equal(snapshot.source.exists, false);
  const published = await saveSettings(root, {
    pi: { extensions: ["generation/new"] },
    omp: { generation: "new" },
  });
  const restored = await restoreSnapshot(root, snapshot.snapshotId, {
    expectedCurrentDigest: published.digest,
    expectedOwnedPaths: ["/pi/extensions", "/omp"],
    requireSourceDigest: true,
  });
  assert.equal(restored.digest, ABSENT_SETTINGS_DIGEST);
  assert.equal((await loadSettings(root)).exists, false);
});

test("snapshot verification rejects owned-value tampering before rollback", async (t) => {
  const root = await isolatedRoot(t);
  await saveSettings(root, { pi: { extensions: ["good"] }, custom: true });
  const snapshot = await createSnapshot(root, {
    id: "tamper-proof",
    ownedPaths: ["/pi/extensions"],
  });
  const manifestFile = path.join(
    root,
    "only-my-pi",
    "snapshots",
    snapshot.snapshotId,
    "manifest.json",
  );
  const manifest = await readJson(manifestFile);
  manifest.owned.values.pi.extensions = ["tampered"];
  await atomicWriteJson(root, manifestFile, manifest);
  await assert.rejects(
    verifyOwnedSettingsSnapshot(root, snapshot.snapshotId),
    (error) => error.code === "SNAPSHOT_DIGEST_MISMATCH",
  );
});

test("last-known-good state verifies generation, snapshot, settings, and restores exact state", async (t) => {
  const root = await isolatedRoot(t);
  const lkgSettings = {
    user: { theme: "night" },
    pi: { extensions: ["generation/good"] },
    omp: { generation: "good" },
  };
  const saved = await saveSettings(root, lkgSettings);
  const snapshot = await createSnapshot(root, {
    id: "lkg-snapshot",
    ownedPaths: ["/pi/extensions", "/omp"],
  });
  const manifest = path.join(root, "only-my-pi", "generations", "good", "manifest.json");
  await atomicWriteJson(root, manifest, { id: "good", files: [] });
  const generationManifestDigest = await hashFile(root, manifest);
  const stateRecord = {
    generationId: `sha256:${"a".repeat(64)}`,
    generationManifestRelativePath: "only-my-pi/generations/good/manifest.json",
    generationManifestDigest,
    settingsDigest: saved.digest,
    snapshotId: snapshot.snapshotId,
    transactionId: "55555555-5555-4555-8555-555555555555",
    metadata: {
      providerSelection: {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        status: "CONFIGURED_UNVERIFIED",
      },
      initialMode: { id: "build", status: "PENDING_M3_RESOLUTION" },
    },
  };
  const state = await writeState(root, stateRecord);
  assert.deepEqual(Object.keys(state).sort(), [
    "$schema",
    "committedAt",
    "digest",
    "formatVersion",
    "generationId",
    "generationManifestDigest",
    "generationManifestRelativePath",
    "metadata",
    "settingsDigest",
    "snapshotId",
    "transactionId",
  ]);
  assert.equal(state.formatVersion, 1);
  assert.equal(Object.hasOwn(state, "schemaVersion"), false);
  await assert.rejects(
    writeState(root, { ...stateRecord, metadata: { unexpected: "not-owned" } }),
    (error) => error.code === "INVALID_LAST_KNOWN_GOOD",
  );
  assert.equal((await readState(root)).digest, state.digest);
  assert.equal((await verifyLastKnownGood(root)).ok, true);

  const changed = await saveSettings(root, {
    ...lkgSettings,
    pi: { extensions: ["generation/bad"] },
    omp: { generation: "bad" },
  });
  await assert.rejects(
    verifyLastKnownGood(root),
    (error) => error.code === "CURRENT_SETTINGS_NOT_LAST_KNOWN_GOOD",
  );
  const restored = await restoreLastKnownGood(root, {
    expectedCurrentDigest: changed.digest,
    expectedOwnedPaths: ["/pi/extensions", "/omp"],
  });
  assert.equal(restored.digest, saved.digest);
  assert.deepEqual(restored.settings, lkgSettings);

  await atomicWriteJson(root, manifest, { id: "tampered", files: [] });
  await assert.rejects(
    verifyLastKnownGood(root),
    (error) => error.code === "GENERATION_MANIFEST_HASH_MISMATCH",
  );
});

test("emitted journal, snapshot, and last-known-good documents validate their v1 schemas", async (t) => {
  const root = await isolatedRoot(t);
  const generationId = `sha256:${"c".repeat(64)}`;
  const saved = await saveSettings(root, {
    packages: ["./only-my-pi/generations/schema"],
    onlyMyPi: { formatVersion: 1 },
  });
  const snapshot = await createSnapshot(root, {
    id: "schema-snapshot",
    ownedPaths: ["/onlyMyPi", "/packages"],
  });
  const manifestRelativePath = "only-my-pi/generations/schema/manifest.json";
  const manifestFile = path.join(root, ...manifestRelativePath.split("/"));
  await atomicWriteJson(root, manifestFile, { generationId, verified: true });
  const generationManifestDigest = await hashFile(root, manifestFile);
  const transactionId = "77777777-7777-4777-8777-777777777777";
  let journal = await createJournal(root, {
    transactionId,
    operation: "bootstrap",
    profileId: "coding",
    generationId,
    snapshotId: snapshot.snapshotId,
  });
  for (const phase of TRANSACTION_PHASES.slice(1, 5)) {
    const evidence = phase === "GRAPH_VERIFIED" ? { generationManifestDigest } : undefined;
    journal = await advanceJournal(root, transactionId, phase, evidence ? { evidence } : {});
  }
  journal = await advanceJournal(root, transactionId, "GRAPH_PROMOTED", {
    evidence: { promotionCreated: true, intendedSettingsDigest: saved.digest },
  });
  const state = await writeState(root, {
    generationId,
    generationManifestRelativePath: manifestRelativePath,
    generationManifestDigest,
    settingsDigest: saved.digest,
    snapshotId: snapshot.snapshotId,
    transactionId,
  });
  await assertSchemaValid("bootstrap-transaction-v1.schema.json", journal);
  await assertSchemaValid("bootstrap-snapshot-v1.schema.json", snapshot);
  await assertSchemaValid("bootstrap-state-v1.schema.json", state);
});
