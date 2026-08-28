import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  advanceUpstreamJournal,
  createUpstreamJournal,
  listUpstreamJournals,
  markUpstreamRecovery,
  upstreamTransactionPaths,
} from "../packages/upstream-migration/index.mjs";

const transactionId = "11111111-1111-4111-8111-111111111111";

test("upstream journal persists ordered durable boundaries with private permissions", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-upstream-journal-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const initial = await createUpstreamJournal(configRoot, {
    transactionId,
    planDigest: `sha256:${"1".repeat(64)}`,
    bundleDigest: `sha256:${"2".repeat(64)}`,
    sourceCommit: "a".repeat(40),
  });
  assert.equal(initial.phase, "PREPARED");
  const advanced = await advanceUpstreamJournal(configRoot, transactionId, "PREFLIGHT_VERIFIED");
  assert.equal(advanced.history.length, 2);
  const paths = upstreamTransactionPaths(configRoot, transactionId);
  assert.equal((await fs.stat(paths.root)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(paths.journal)).mode & 0o777, 0o600);
  assert.equal((await listUpstreamJournals(configRoot, { incompleteOnly: true })).length, 1);
  await assert.rejects(advanceUpstreamJournal(configRoot, transactionId, "PI_STAGED"), { code: "UPSTREAM_PHASE_ORDER_INVALID" });
});

test("recovery status is terminal and cannot be silently advanced", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-upstream-recovery-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  await createUpstreamJournal(configRoot, {
    transactionId,
    planDigest: `sha256:${"1".repeat(64)}`,
    bundleDigest: `sha256:${"2".repeat(64)}`,
    sourceCommit: "a".repeat(40),
  });
  const settled = await markUpstreamRecovery(configRoot, transactionId, { status: "ROLLED_BACK", failureCode: "FAULT_INJECTED" });
  assert.equal(settled.status, "ROLLED_BACK");
  assert.equal((await listUpstreamJournals(configRoot, { incompleteOnly: true })).length, 0);
  await assert.rejects(advanceUpstreamJournal(configRoot, transactionId, "PREFLIGHT_VERIFIED"), { code: "UPSTREAM_TRANSACTION_TERMINAL" });
});
