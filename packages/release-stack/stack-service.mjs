import fs from "node:fs/promises";
import path from "node:path";

import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { canonicalJson } from "../config-runtime/index.mjs";
import { hashFile } from "./deterministic-archive.mjs";
import { planStackEnvironment } from "./environment-planner.mjs";
import { listStackJournals, readStackJournal } from "./stack-journal.mjs";
import { stackTransactionLayout } from "./layout.mjs";
import { sha256, validateStackManifest, validateStackState } from "./contracts.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

async function lstatOrNull(target) {
  return fs.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
}

async function boundedJson(file, maxBytes = 16 * 1024 * 1024) {
  const stat = await lstatOrNull(file);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail("STACK_STATE_INVALID", `stack state file is unsafe: ${path.basename(file)}`);
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { fail("STACK_STATE_INVALID", `stack state file is invalid JSON: ${path.basename(file)}`); }
}

async function installedState(layout) {
  const stat = await lstatOrNull(layout.stateFile);
  if (!stat) return null;
  return validateStackState(await boundedJson(layout.stateFile));
}

function stackDirectory(layout, stackId) {
  return path.join(layout.stacksRoot, stackId.slice("sha256:".length));
}

async function assertPointer(target, expected) {
  const stat = await lstatOrNull(target);
  if (!stat?.isSymbolicLink()) fail("STACK_POINTER_DRIFT", `controlled pointer is missing or not a symlink: ${path.basename(target)}`);
  if (await fs.realpath(target) !== expected) fail("STACK_POINTER_DRIFT", `controlled pointer targets the wrong stack asset: ${path.basename(target)}`);
}

async function digestTree(artifactRoot, relativePath) {
  return `sha256:${await hashResourcePath({ artifactRoot, relativePath, allowContainedSymlinks: true })}`;
}

async function verifyInstalled(layout, state) {
  const root = stackDirectory(layout, state.activeStack);
  const rootStat = await lstatOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) fail("STACK_ROOT_DRIFT", "active stack root is missing or unsafe");
  const manifest = validateStackManifest(await boundedJson(path.join(root, "stack-manifest.json")));
  if (manifest.stackId !== state.activeStack || state.manifestDigest !== manifest.stackId) fail("STACK_STATE_MANIFEST_MISMATCH", "active stack state and manifest differ");
  await Promise.all([
    assertPointer(layout.currentStack, root),
    assertPointer(layout.ompShim, path.join(root, "bin", "omp")),
    assertPointer(layout.piShim, path.join(root, "bin", "pi")),
  ]);
  const identities = {
    node: await digestTree(root, "node"),
    pi: await digestTree(root, "pi"),
    external: await digestTree(layout.configRoot, path.relative(layout.configRoot, layout.npmRoot)),
    onlyMyPi: await hashFile(path.join(root, "only-my-pi.tgz")),
  };
  if (identities.node !== manifest.runtime.node.treeDigest || identities.pi !== manifest.runtime.pi.treeDigest
    || identities.external !== manifest.externalTreeDigest || identities.onlyMyPi !== manifest.onlyMyPi.artifactSha256) {
    fail("STACK_ASSET_DRIFT", "installed stack assets differ from their canonical manifest");
  }
  return Object.freeze({ root, manifest, identities });
}

function bindSourcePlan(base, inspection, shellProfile = null) {
  const plan = {
    ...base,
    source: {
      version: inspection.version,
      channel: inspection.channel,
      tag: inspection.tag,
      sourceCommit: inspection.sourceCommit,
      releaseStatus: inspection.releaseStatus,
      asset: inspection.asset,
      stackManifestSha256: inspection.stackManifestSha256,
    },
    shellProfile,
  };
  delete plan.planDigest;
  plan.planDigest = sha256(canonicalJson(plan));
  return Object.freeze(plan);
}

async function readPriorState(layout, transactionId) {
  const rollback = await boundedJson(stackTransactionLayout(layout, transactionId).rollback);
  if (!rollback.state?.exists) return null;
  try { return validateStackState(JSON.parse(Buffer.from(rollback.state.contentBase64, "base64").toString("utf8"))); }
  catch { fail("STACK_ROLLBACK_STATE_INVALID", "stack rollback state is invalid"); }
}

function lifecycleDigest(plan) {
  const output = structuredClone(plan);
  delete output.planDigest;
  return sha256(canonicalJson(output));
}

export class StackService {
  constructor({ layout, localSource, releaseSource, engine, shellProfile = null, platformInspector = null, pathValue = () => process.env.PATH ?? "" } = {}) {
    if (!layout?.shareRoot || !localSource || !releaseSource || !engine) throw new TypeError("stack service requires layout, local/release sources, and transaction engine");
    this.layout = layout;
    this.localSource = localSource;
    this.releaseSource = releaseSource;
    this.engine = engine;
    this.shellProfile = shellProfile;
    this.platformInspector = platformInspector ?? (async () => ({ os: process.platform, arch: process.arch, minimumMacOSSatisfied: false, rosetta: false }));
    this.pathValue = pathValue;
  }

  async releaseCheck(options = {}) {
    return this.releaseSource.check(options);
  }

  source(options) {
    return options.bundle ? this.localSource : this.releaseSource;
  }

  async planInstall(options = {}) {
    const inspection = await this.source(options).inspect(options);
    const base = await planStackEnvironment({
      layout: this.layout,
      stackManifest: inspection.stackManifest,
      payloadMode: inspection.payloadMode,
      operation: options.subcommand,
      platform: await this.platformInspector(),
      pathValue: this.pathValue(),
    });
    let shellProfile = null;
    if (options.configureShell === true && base.path.actionRequired) {
      if (!this.shellProfile) fail("SHELL_PROFILE_UNAVAILABLE", "shell configuration service is unavailable");
      shellProfile = await this.shellProfile.plan();
    }
    return bindSourcePlan(base, inspection, shellProfile);
  }

  async applyInstall(options = {}, reviewedPlan) {
    await this.engine.recoverPending();
    const currentPlan = await this.planInstall(options);
    if (currentPlan.planDigest !== reviewedPlan?.planDigest) fail("STACK_PLAN_DRIFT", "stack environment or release source changed after review");
    const prepared = await this.source(options).prepare(options);
    if (prepared.stackId !== currentPlan.stackId || prepared.asset.sha256 !== currentPlan.source.asset.sha256) fail("STACK_PAYLOAD_DRIFT", "prepared payload differs from the reviewed source");
    try {
      return await this.engine.apply({ plan: currentPlan, stackManifest: prepared.stackManifest, resolvedRoot: prepared.resolvedRoot, terminatePi: options.terminatePi === true });
    } finally {
      await prepared.cleanup();
    }
  }

  async status() {
    const incomplete = await listStackJournals(this.layout, { incompleteOnly: true });
    const state = await installedState(this.layout);
    if (!state) return Object.freeze({ formatVersion: 1, ok: true, status: "NOT_INSTALLED", code: "NOT_INSTALLED", message: "No public Preview stack is installed", next: "omp stack install --release 0.2.0-preview.1", mutation: false, incompleteTransactions: incomplete.map((entry) => entry.transactionId) });
    const verified = await verifyInstalled(this.layout, state);
    return Object.freeze({
      formatVersion: 1,
      ok: incomplete.length === 0,
      status: incomplete.length === 0 ? "INSTALLED" : "INTERRUPTED",
      code: incomplete.length === 0 ? "INSTALLED" : "INCOMPLETE_STACK_TRANSACTION",
      message: incomplete.length === 0 ? "The public Preview stack is installed and verified" : "The stack has an incomplete transaction",
      next: incomplete.length === 0 ? null : "rerun a mutating omp stack command to recover before continuing",
      mutation: false,
      stackId: state.activeStack,
      payloadMode: state.payloadMode,
      nodeVersion: state.node.version,
      piVersion: state.pi.version,
      onlyMyPiVersion: state.onlyMyPi.version,
      generationId: state.generation.digest,
      externalOwnership: { binding: "external", owner: "user", packageCount: state.externalPackages.length },
      identities: verified.identities,
      incompleteTransactions: incomplete.map((entry) => entry.transactionId),
    });
  }

  async planLifecycle(options = {}) {
    const state = await installedState(this.layout);
    if (!state) fail("STACK_NOT_INSTALLED", "no public Preview stack is installed");
    await verifyInstalled(this.layout, state);
    const reverse = [...state.transactionIds].reverse();
    let transactionIds;
    let targetStackId;
    if (options.subcommand === "remove") {
      transactionIds = reverse;
      targetStackId = null;
    } else {
      targetStackId = options.to ?? state.lkgStack;
      if (!targetStackId) fail("STACK_LKG_UNAVAILABLE", "no previous stack is available for rollback");
      transactionIds = [];
      for (const transactionId of reverse) {
        const journal = await readStackJournal(this.layout, transactionId);
        if (journal.status !== "COMMITTED") fail("STACK_ROLLBACK_TRANSACTION_INVALID", "stack history contains a non-committed transaction");
        transactionIds.push(transactionId);
        const prior = await readPriorState(this.layout, transactionId);
        if (prior?.activeStack === targetStackId) break;
      }
      const lastPrior = await readPriorState(this.layout, transactionIds.at(-1));
      if (lastPrior?.activeStack !== targetStackId) fail("STACK_ROLLBACK_TARGET_UNKNOWN", "requested stack is not present in the verified rollback chain");
    }
    const plan = {
      formatVersion: 1,
      kind: "only-my-pi-stack-lifecycle-plan",
      operation: options.subcommand,
      mutation: false,
      status: options.subcommand === "remove" ? "STACK_REMOVE_PLAN" : "STACK_ROLLBACK_PLAN",
      activeStackId: state.activeStack,
      targetStackId,
      transactionIds,
      externalOwnership: "external/user",
      systemHomebrewMutation: false,
      userDataDeletion: false,
    };
    plan.planDigest = lifecycleDigest(plan);
    return Object.freeze(plan);
  }

  async applyLifecycle(options = {}, reviewedPlan) {
    const plan = await this.planLifecycle(options);
    if (plan.planDigest !== reviewedPlan?.planDigest) fail("STACK_PLAN_DRIFT", "stack lifecycle state changed after review");
    const result = await this.engine.rollbackCommitted(plan.transactionIds, { terminatePi: options.terminatePi === true, failureCode: options.subcommand === "remove" ? "EXPLICIT_STACK_REMOVE" : "EXPLICIT_STACK_ROLLBACK" });
    return Object.freeze({ ...result, status: options.subcommand === "remove" ? "REMOVED" : "ROLLED_BACK", code: options.subcommand === "remove" ? "REMOVED" : "ROLLED_BACK", stackId: plan.targetStackId, externalOwnership: "external/user", systemHomebrewModified: false, userDataDeleted: false });
  }
}

export function createStackService(options) {
  return new StackService(options);
}
