import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { guardedWriterAuthorizationDigest } from "../packages/subagents/release/guarded-writer-authorization.mjs";
import {
  createGuardedWriterReconciliationPlan,
  validateGuardedWriterReconciliationPlan,
} from "../packages/subagents/release/guarded-writer-reconciliation.mjs";
import {
  executeGuardedWriterReconciliation,
  parseGuardedWriterReconcileArgs,
} from "../scripts/subagents-guarded-writer-reconcile.mjs";

const rootDir = path.resolve(".");
const authorizationId = "fixture-guarded-writer-authorization";
const authorizationDigest = `sha256:${"1".repeat(64)}`;
const sourceCommit = "2".repeat(40);
const observedAt = Date.parse("2026-08-22T03:00:00.000Z");

async function roots(t) {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-writer-reconcile-"));
  t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "config");
  const repositoryRoot = path.join(root, "source");
  const home = path.join(root, "home");
  await Promise.all([configRoot, repositoryRoot, home].map((directory) => fsPromises.mkdir(directory)));
  return {
    root: await fsPromises.realpath(root),
    configRoot: await fsPromises.realpath(configRoot),
    repositoryRoot: await fsPromises.realpath(repositoryRoot),
    home: await fsPromises.realpath(home),
  };
}

function runtimeRoot(configRoot) {
  return path.join(configRoot, "only-my-pi", "subagents-guarded-writer", authorizationId);
}

async function writeRuntime(configRoot, { request = "valid", omit = null } = {}) {
  const runtime = runtimeRoot(configRoot);
  const directories = {
    agentRoot: path.join(runtime, "agent"),
    sessionRoot: path.join(runtime, "agent", "sessions"),
    artifactRoot: path.join(runtime, "tmp"),
    fixtureRoot: path.join(runtime, "fixture-repo"),
    worktreeRoot: path.join(runtime, "worktrees"),
  };
  for (const [id, directory] of Object.entries(directories)) {
    if (id !== omit) await fsPromises.mkdir(directory, { recursive: true });
  }
  if (request !== "missing") {
    const file = path.join(directories.agentRoot, "guarded-writer-request.json");
    if (request === "truncated") await fsPromises.writeFile(file, "{\"authorizationDigest\":");
    else {
      await fsPromises.writeFile(file, `${JSON.stringify({
        authorizationDigest,
        sourceCommit,
        runtimeRoot: runtime,
        agentRoot: directories.agentRoot,
        fixtureRoot: directories.fixtureRoot,
        artifactRoot: directories.artifactRoot,
        worktreeRoot: directories.worktreeRoot,
        baseCommit: "3".repeat(40),
      }, null, 2)}\n`);
    }
  }
  return { runtime, directories };
}

function planInput(values) {
  return {
    configRoot: values.configRoot,
    repositoryRoot: values.repositoryRoot,
    authorizationId,
    authorizationDigest,
    sourceCommit,
    homedir: () => values.home,
    now: () => observedAt,
  };
}

test("reconciliation is review-only for both missing and complete runtime targets", async (t) => {
  const example = JSON.parse(await fsPromises.readFile(
    path.join(rootDir, "contracts", "subagents", "guarded-writer-reconciliation.example.json"),
    "utf8",
  ));
  assert.doesNotThrow(() => validateGuardedWriterReconciliationPlan(example));
  const values = await roots(t);
  const missing = await createGuardedWriterReconciliationPlan(planInput(values));
  assert.equal(missing.runtimeState, "NOT_FOUND");
  assert.equal(missing.cleanup.disposition, "NO_TARGET");
  assert.equal(missing.cleanup.deleteAuthorized, false);
  assert.equal(missing.cleanup.applyAvailable, false);
  assert.equal(missing.cleanup.applyCommand, null);
  assert.doesNotThrow(() => validateGuardedWriterReconciliationPlan(missing, {
    expectedAuthorizationDigest: authorizationDigest,
    expectedSourceCommit: sourceCommit,
  }));

  await writeRuntime(values.configRoot);
  const complete = await createGuardedWriterReconciliationPlan(planInput(values));
  assert.equal(complete.runtimeState, "READY_FOR_REVIEW");
  assert.equal(complete.request.state, "VALID");
  assert.equal(complete.components.every((entry) => entry.state === "PRESENT"), true);
  assert.equal(complete.cleanup.disposition, "RETAIN_FOR_REVIEW");
  assert.deepEqual(complete.blockers, [
    "ACTIVE_PROCESS_STATUS_UNVERIFIED",
    "EVIDENCE_STAGING_STATUS_UNVERIFIED",
    "OPERATOR_REVIEW_REQUIRED",
  ]);
  assert.equal(JSON.stringify(complete).includes(values.configRoot), false);
  assert.equal(JSON.stringify(complete).includes(values.repositoryRoot), false);
});

test("partial request, source drift, and symlink topology remain retained and fail closed", async (t) => {
  const truncatedValues = await roots(t);
  await writeRuntime(truncatedValues.configRoot, { request: "truncated" });
  const truncated = await createGuardedWriterReconciliationPlan(planInput(truncatedValues));
  assert.equal(truncated.runtimeState, "PARTIAL");
  assert.equal(truncated.request.state, "INVALID");
  assert.equal(truncated.request.findings.includes("REQUEST_JSON_INVALID"), true);
  assert.equal(truncated.cleanup.deleteAuthorized, false);

  const driftValues = await roots(t);
  const { directories } = await writeRuntime(driftValues.configRoot);
  const requestPath = path.join(directories.agentRoot, "guarded-writer-request.json");
  const drifted = JSON.parse(await fsPromises.readFile(requestPath, "utf8"));
  drifted.sourceCommit = "4".repeat(40);
  await fsPromises.writeFile(requestPath, `${JSON.stringify(drifted)}\n`);
  const drift = await createGuardedWriterReconciliationPlan(planInput(driftValues));
  assert.equal(drift.runtimeState, "PARTIAL");
  assert.equal(drift.blockers.includes("SOURCE_BINDING_DRIFT"), true);

  if (process.platform !== "win32") {
    const symlinkValues = await roots(t);
    const written = await writeRuntime(symlinkValues.configRoot, { omit: "worktreeRoot" });
    const outside = path.join(symlinkValues.root, "outside-worktrees");
    await fsPromises.mkdir(outside);
    await fsPromises.symlink(outside, written.directories.worktreeRoot);
    const unsafe = await createGuardedWriterReconciliationPlan(planInput(symlinkValues));
    assert.equal(unsafe.runtimeState, "UNSAFE");
    assert.equal(unsafe.blockers.includes("UNSAFE_PATH_TOPOLOGY"), true);
    assert.equal(unsafe.cleanup.disposition, "RETAIN_FOR_REVIEW");
  }
});

test("plan digest and real-Pi/source-overlap boundaries reject mutation or target drift", async (t) => {
  const values = await roots(t);
  const plan = await createGuardedWriterReconciliationPlan(planInput(values));
  const tampered = structuredClone(plan);
  tampered.cleanup.deleteAuthorized = true;
  assert.throws(() => validateGuardedWriterReconciliationPlan(tampered), { code: "RECONCILIATION_MUTATION_FORBIDDEN" });
  const digestDrift = structuredClone(plan);
  digestDrift.runtimeState = "PARTIAL";
  assert.throws(() => validateGuardedWriterReconciliationPlan(digestDrift), { code: "RECONCILIATION_PLAN_DIGEST_DRIFT" });

  const overlappingSource = path.join(values.configRoot, "source");
  await fsPromises.mkdir(overlappingSource);
  await assert.rejects(createGuardedWriterReconciliationPlan({
    ...planInput(values),
    repositoryRoot: overlappingSource,
  }), { code: "RECONCILIATION_ROOT_OVERLAP" });

  const piRoot = path.join(values.home, ".pi", "disposable");
  await fsPromises.mkdir(piRoot, { recursive: true });
  await assert.rejects(createGuardedWriterReconciliationPlan({ ...planInput(values), configRoot: piRoot }), {
    code: "RECONCILIATION_REAL_PI_HOME_FORBIDDEN",
  });
});

test("reconciliation CLI has no apply surface and its default plan performs no inspection", async (t) => {
  assert.equal(parseGuardedWriterReconcileArgs([]).operation, "plan");
  assert.throws(() => parseGuardedWriterReconcileArgs(["--run"]), /review-only/u);
  assert.throws(() => parseGuardedWriterReconcileArgs(["--apply"]), /review-only/u);
  let plannerCalls = 0;
  const empty = await executeGuardedWriterReconciliation([], {
    planner: async () => { plannerCalls += 1; },
  });
  assert.equal(empty.status, "INPUT_REQUIRED");
  assert.equal(empty.mutation, "NOT_AVAILABLE");
  assert.equal(plannerCalls, 0);

  const values = await roots(t);
  const authorization = {
    contractStatus: "operator-authorized-live",
    authorizationId,
    sourceCommit,
  };
  authorization.authorizationDigest = guardedWriterAuthorizationDigest(authorization);
  const authorizationFile = path.join(values.root, "authorization.json");
  await fsPromises.writeFile(authorizationFile, `${JSON.stringify(authorization)}\n`);
  const result = await executeGuardedWriterReconciliation([
    "--plan", "--authorization-file", authorizationFile,
    "--config-root", values.configRoot, "--repository-root", values.repositoryRoot, "--json",
  ], {
    sourceInspector: async () => ({ sourceCommit, dirty: false }),
    now: () => observedAt,
  });
  assert.equal(result.status, "NO_TARGET");
  assert.equal(result.currentSourceMatches, true);
  assert.deepEqual(result.currentSourceFindings, []);
  assert.equal(result.plan.cleanup.deleteAuthorized, false);
  assert.doesNotThrow(() => validateGuardedWriterReconciliationPlan(result.plan));
});
