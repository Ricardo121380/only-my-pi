import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import { finalizeStackState, sha256, validateStackManifest } from "./contracts.mjs";
import { inspectResolvedStack } from "./release-builder.mjs";
import { stackTransactionLayout } from "./layout.mjs";
import {
  advanceStackJournal,
  createStackJournal,
  listStackJournals,
  markStackJournal,
  readStackJournal,
  writeStackJson,
} from "./stack-journal.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

async function lstatOrNull(target) {
  return fs.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
}

async function readFileSnapshot(target, { maxBytes = 16 * 1024 * 1024 } = {}) {
  const stat = await lstatOrNull(target);
  if (!stat) return Object.freeze({ exists: false, digest: sha256(""), contentBase64: null });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) fail("STACK_BACKUP_PATH_UNSAFE", `backup target is not a bounded regular file: ${path.basename(target)}`);
  const bytes = await fs.readFile(target);
  return Object.freeze({ exists: true, digest: sha256(bytes), contentBase64: bytes.toString("base64") });
}

async function readLinkSnapshot(target, shareRoot) {
  const stat = await lstatOrNull(target);
  if (!stat) return Object.freeze({ exists: false, relativeTarget: null });
  if (!stat.isSymbolicLink()) fail("STACK_POINTER_CONFLICT", `controlled pointer is not a symlink: ${path.basename(target)}`);
  const real = await fs.realpath(target).catch(() => null);
  if (!real || (real !== shareRoot && !real.startsWith(`${shareRoot}${path.sep}`))) fail("STACK_POINTER_CONFLICT", `controlled pointer escapes stack root: ${path.basename(target)}`);
  return Object.freeze({ exists: true, relativeTarget: path.relative(path.dirname(target), real) });
}

async function atomicWriteBytes(target, bytes, mode = 0o600) {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${crypto.randomUUID()}`);
  await fs.writeFile(temporary, bytes, { mode, flag: "wx" });
  await fs.chmod(temporary, mode);
  await fs.rename(temporary, target);
}

async function atomicSymlink(target, linkValue) {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${crypto.randomUUID()}`);
  await fs.symlink(linkValue, temporary);
  await fs.rename(temporary, target);
}

async function restoreLink(target, snapshot) {
  const stat = await lstatOrNull(target);
  if (stat) {
    if (!stat.isSymbolicLink()) fail("CONCURRENT_STACK_POINTER_CHANGE", `controlled pointer became a non-symlink: ${path.basename(target)}`);
    await fs.unlink(target);
  }
  if (snapshot?.exists) await atomicSymlink(target, snapshot.relativeTarget);
}

function packageName(setting) {
  const value = typeof setting === "string" ? setting : setting?.source;
  const match = /^npm:(@[^/]+\/[^@]+|[^@]+)@([^@]+)$/u.exec(value ?? "");
  return match?.[1] ?? null;
}

function publishPackageSettings(settings, stack) {
  const output = structuredClone(settings ?? {});
  if (output.packages !== undefined && !Array.isArray(output.packages)) fail("STACK_SETTINGS_INVALID", "settings packages must be an array");
  const expected = new Map(stack.externalPackages.map((entry) => [entry.name, `npm:${entry.name}@${entry.version}`]));
  const found = new Set();
  output.packages = (output.packages ?? []).map((setting) => {
    const name = packageName(setting);
    if (!expected.has(name)) return setting;
    if (found.has(name)) fail("STACK_SETTINGS_PACKAGE_DUPLICATE", `settings selects ${name} more than once`);
    found.add(name);
    const source = expected.get(name);
    if (typeof setting === "string") return source;
    return { ...setting, source };
  });
  for (const [name, source] of expected) if (!found.has(name)) output.packages.push(source);
  return output;
}

function stackPath(layout, stackId) {
  return path.join(layout.stacksRoot, stackId.slice("sha256:".length));
}

async function writeStackBins(stage) {
  const bin = path.join(stage, "bin");
  await fs.mkdir(bin, { recursive: true, mode: 0o755 });
  const pi = `#!/bin/sh\nset -eu\nSTACK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)\nexec "$STACK_ROOT/node/bin/node" "$STACK_ROOT/pi/dist/bundle/cli.js" "$@"\n`;
  const omp = `#!/bin/sh\nset -eu\nSTACK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)\nexec "$STACK_ROOT/node/bin/node" "$STACK_ROOT/only-my-pi/package/bin/omp.mjs" "$@"\n`;
  await fs.writeFile(path.join(bin, "pi"), pi, { mode: 0o755 });
  await fs.writeFile(path.join(bin, "omp"), omp, { mode: 0o755 });
}

function safePlan(plan) {
  return {
    formatVersion: 1,
    kind: "only-my-pi-stack-plan-record",
    planDigest: plan.planDigest,
    operation: plan.operation,
    stackId: plan.stackId,
    payloadMode: plan.payloadMode,
    external: plan.external,
    path: plan.path,
    systemRoots: plan.systemRoots,
    privacy: plan.privacy,
  };
}

function receipt(context, status, failureCode = null) {
  return Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-stack-transaction-receipt",
    transactionId: context.transactionId,
    operation: context.plan.operation,
    status,
    failureCode,
    stackId: context.stack.stackId,
    payloadMode: context.plan.payloadMode,
    externalOwnership: { binding: "external", owner: "user", packageCount: 9 },
    systemHomebrewModified: false,
    authRead: false,
    sessionsRead: false,
    providerSecretsRead: false,
    hostAbsolutePathsRecorded: false,
  });
}

export class StackTransactionEngine {
  constructor({ layout, processAdmission = null, harness = null, doctor = null, smoke = null, transactionIdFactory = () => crypto.randomUUID(), onBoundary = null } = {}) {
    if (!layout?.shareRoot) throw new TypeError("StackTransactionEngine requires a stack layout");
    this.layout = layout;
    this.processAdmission = processAdmission;
    this.harness = harness;
    this.doctor = doctor;
    this.smoke = smoke;
    this.transactionIdFactory = transactionIdFactory;
    this.onBoundary = onBoundary;
  }

  async advance(context, phase) {
    context.journal = await advanceStackJournal(this.layout, context.transactionId, phase);
    if (typeof this.onBoundary === "function") await this.onBoundary(phase, Object.freeze({ transactionId: context.transactionId, journal: context.journal }));
  }

  async apply({ plan, stackManifest, resolvedRoot, terminatePi = false } = {}) {
    if (plan?.kind !== "only-my-pi-stack-plan" || plan.stackId !== stackManifest?.stackId) fail("STACK_PLAN_INVALID", "reviewed stack plan does not match the manifest");
    await this.recoverPending();
    const stack = validateStackManifest(stackManifest);
    await inspectResolvedStack({ resolvedRoot, stackManifest: stack });
    const transactionId = this.transactionIdFactory();
    const paths = stackTransactionLayout(this.layout, transactionId);
    const context = { transactionId, paths, plan, stack, resolvedRoot: path.resolve(resolvedRoot), journal: null, rollback: null, publishedSettingsDigest: null };
    context.journal = await createStackJournal(this.layout, { transactionId, operation: plan.operation, stackId: stack.stackId, planDigest: plan.planDigest });
    await writeStackJson(paths.plan, safePlan(plan));
    try {
      await this.advance(context, "PAYLOADS_VERIFIED");
      await this.advance(context, "BACKUP_DURABLE");
      await this.backup(context);
      await this.advance(context, "NODE_STAGED");
      await this.stageDirectory(context, "node");
      await this.advance(context, "PI_STAGED");
      await this.stageDirectory(context, "pi");
      await this.advance(context, "EXTERNAL_TREE_STAGED");
      if (plan.external.switchRequired) await fs.cp(path.join(resolvedRoot, "external-npm"), paths.externalStage, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: false });
      await this.advance(context, "OMP_ARTIFACT_STAGED");
      await fs.cp(path.join(resolvedRoot, "only-my-pi.tgz"), path.join(paths.stage, "only-my-pi.tgz"), { force: false, errorOnExist: true });
      await this.advance(context, "GENERATION_STAGED");
      await this.harness?.stage?.({ context, artifact: path.join(paths.stage, "only-my-pi.tgz") });
      await this.advance(context, "SHIMS_STAGED");
      await fs.writeFile(path.join(paths.stage, "stack-manifest.json"), `${JSON.stringify(stack, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await writeStackBins(paths.stage);
      await this.advance(context, "PI_PROCESSES_STOPPED");
      const processes = await this.processAdmission?.plan?.() ?? [];
      if (processes.length > 0) {
        if (!terminatePi) fail("PI_TERMINATION_AUTHORITY_REQUIRED", "running Pi processes require explicit --terminate-pi authority");
        await this.processAdmission.terminate(processes, { authorized: true });
      }
      await this.advance(context, "EXTERNAL_TREE_SWITCHED");
      await this.switchExternal(context);
      await this.advance(context, "SETTINGS_PUBLISHED");
      await this.publishSettings(context);
      await this.advance(context, "STACK_ACTIVATED");
      await this.activateStack(context);
      await this.advance(context, "SHIMS_ACTIVATED");
      await this.activateShims(context);
      await this.advance(context, "STATIC_DOCTOR_PASSED");
      const doctor = await this.doctor?.({ context }) ?? { ok: true, status: "NOT_CONFIGURED" };
      if (doctor.ok !== true) fail("STACK_STATIC_DOCTOR_FAILED", "installed stack failed static doctor", { doctor });
      await this.advance(context, "NO_MODEL_SMOKE_PASSED");
      const smoke = await this.smoke?.({ context }) ?? { ok: true, status: "NOT_CONFIGURED" };
      if (smoke.ok !== true) fail("STACK_NO_MODEL_SMOKE_FAILED", "installed stack failed no-model smoke", { smoke });
      await this.advance(context, "LKG_RECORDED");
      await this.recordState(context);
      await this.advance(context, "COMMITTED");
      const result = receipt(context, "COMMITTED");
      await writeStackJson(paths.receipt, result);
      return Object.freeze({ ok: true, status: plan.path.actionRequired ? "PATH_ACTION_REQUIRED" : "COMMITTED", code: plan.path.actionRequired ? "PATH_ACTION_REQUIRED" : "COMMITTED", mutation: true, transactionId, receipt: result, next: plan.path.actionRequired ? `add ${this.layout.binRoot} to PATH` : null });
    } catch (error) {
      if (error?.simulateCrash === true) throw error;
      try { error.recovery = await this.recoverTransaction(transactionId, { failureCode: error?.code ?? "STACK_APPLY_FAILED" }); }
      catch (recoveryError) {
        await markStackJournal(this.layout, transactionId, { status: "MANUAL_RECONCILIATION_REQUIRED", failureCode: recoveryError?.code ?? "STACK_RECOVERY_FAILED" });
        error.recovery = { status: "MANUAL_RECONCILIATION_REQUIRED", code: recoveryError?.code ?? "STACK_RECOVERY_FAILED" };
      }
      throw error;
    }
  }

  async backup(context) {
    await Promise.all([
      fs.mkdir(this.layout.stacksRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.layout.binRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.layout.configRoot, { recursive: true, mode: 0o700 }),
    ]);
    for (const target of [context.paths.stage, context.paths.externalStage, context.paths.externalBackup, stackPath(this.layout, context.stack.stackId)]) if (await lstatOrNull(target)) fail("STACK_STAGING_COLLISION", `stack staging target already exists: ${path.basename(target)}`);
    const rollback = {
      formatVersion: 1,
      kind: "only-my-pi-stack-rollback-manifest",
      transactionId: context.transactionId,
      settings: await readFileSnapshot(this.layout.settingsFile),
      state: await readFileSnapshot(this.layout.stateFile),
      currentStack: await readLinkSnapshot(this.layout.currentStack, this.layout.shareRoot),
      lkgStack: await readLinkSnapshot(this.layout.lkgStack, this.layout.shareRoot),
      ompShim: await readLinkSnapshot(this.layout.ompShim, this.layout.shareRoot),
      piShim: await readLinkSnapshot(this.layout.piShim, this.layout.shareRoot),
      externalRootExisted: Boolean(await lstatOrNull(this.layout.npmRoot)),
      externalRootDigest: context.plan.external.priorRootDigest,
      externalSwitchRequired: context.plan.external.switchRequired,
      targetSettingsDigest: null,
    };
    await writeStackJson(context.paths.rollback, rollback);
    context.rollback = rollback;
  }

  async stageDirectory(context, name) {
    await fs.mkdir(context.paths.stage, { recursive: true, mode: 0o700 });
    await fs.cp(path.join(context.resolvedRoot, name), path.join(context.paths.stage, name), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: false });
  }

  async switchExternal(context) {
    if (!context.plan.external.switchRequired) return;
    if (await lstatOrNull(this.layout.npmRoot)) await fs.rename(this.layout.npmRoot, context.paths.externalBackup);
    await fs.rename(context.paths.externalStage, this.layout.npmRoot);
  }

  async publishSettings(context) {
    const current = await readFileSnapshot(this.layout.settingsFile);
    if (current.digest !== context.rollback.settings.digest) fail("CONCURRENT_TARGETED_SETTINGS_CHANGE", "settings changed after the reviewed plan");
    const original = current.exists ? JSON.parse(Buffer.from(current.contentBase64, "base64").toString("utf8")) : {};
    const published = publishPackageSettings(original, context.stack);
    const harnessResult = await this.harness?.publish?.({ context, settings: published });
    const finalSettings = harnessResult?.settings ?? published;
    context.harnessGenerationId = harnessResult?.generationId ?? null;
    context.rollback.harness = harnessResult?.rollbackIdentity ?? null;
    const bytes = Buffer.from(`${JSON.stringify(finalSettings, null, 2)}\n`);
    await atomicWriteBytes(this.layout.settingsFile, bytes);
    context.publishedSettingsDigest = sha256(bytes);
    context.rollback.targetSettingsDigest = context.publishedSettingsDigest;
    await writeStackJson(context.paths.rollback, context.rollback);
  }

  async activateStack(context) {
    const target = stackPath(this.layout, context.stack.stackId);
    await fs.rename(context.paths.stage, target);
    context.activeStackPath = target;
    await restoreLink(this.layout.currentStack, { exists: true, relativeTarget: path.relative(path.dirname(this.layout.currentStack), target) });
  }

  async activateShims(context) {
    await restoreLink(this.layout.ompShim, { exists: true, relativeTarget: path.relative(path.dirname(this.layout.ompShim), path.join(this.layout.currentStack, "bin", "omp")) });
    await restoreLink(this.layout.piShim, { exists: true, relativeTarget: path.relative(path.dirname(this.layout.piShim), path.join(this.layout.currentStack, "bin", "pi")) });
  }

  async recordState(context) {
    const priorState = context.rollback.state.exists
      ? JSON.parse(Buffer.from(context.rollback.state.contentBase64, "base64").toString("utf8"))
      : null;
    if (context.rollback.currentStack.exists) {
      await restoreLink(this.layout.lkgStack, context.rollback.currentStack);
    } else {
      await restoreLink(this.layout.lkgStack, { exists: false, relativeTarget: null });
    }
    const dispositions = new Map(context.plan.external.existing.map((entry) => [entry.name, "PREEXISTING_EXTERNAL"]));
    const state = finalizeStackState({
      $schema: "../../schemas/stack-state-v1.schema.json",
      formatVersion: 1,
      kind: "only-my-pi-stack-state",
      status: "INSTALLED",
      activeStack: context.stack.stackId,
      lkgStack: priorState?.activeStack ?? null,
      manifestDigest: context.stack.stackId,
      payloadMode: context.plan.payloadMode,
      node: { version: context.stack.runtime.node.version, digest: context.stack.runtime.node.treeDigest },
      pi: { version: context.stack.runtime.pi.version, digest: context.stack.runtime.pi.treeDigest },
      onlyMyPi: { version: context.stack.onlyMyPi.version, digest: context.stack.onlyMyPi.artifactSha256 },
      generation: { version: "generation-v1", digest: await this.harness?.generationId?.({ context }) ?? context.stack.generationTargetGraphDigest },
      cliArtifact: { version: context.stack.onlyMyPi.version, digest: context.stack.onlyMyPi.artifactSha256 },
      shims: {
        omp: { targetClass: "USER_LOCAL_CONTROLLED_STACK", digest: sha256("current-stack/bin/omp") },
        pi: { targetClass: "USER_LOCAL_CONTROLLED_STACK", digest: sha256("current-stack/bin/pi") },
      },
      externalPackages: context.stack.externalPackages.map((entry) => ({
        name: entry.name,
        version: entry.version,
        binding: "external",
        owner: "user",
        assetDisposition: dispositions.get(entry.name) ?? "PROVISIONED_FOR_USER",
        treeDigest: entry.treeDigest,
      })),
      transactionIds: [...(priorState?.transactionIds ?? []), context.transactionId],
      removalEligibility: {
        stack: true,
        externalTree: context.plan.external.classification === "EMPTY",
        reasonCodes: context.plan.external.classification === "EMPTY" ? [] : ["PREEXISTING_EXTERNAL_ASSETS"],
      },
    });
    await writeStackJson(this.layout.stateFile, state);
  }

  async recoverPending() {
    const pending = await listStackJournals(this.layout, { incompleteOnly: true });
    const results = [];
    for (const journal of pending) {
      const result = await this.recoverTransaction(journal.transactionId, { failureCode: "AUTOMATIC_CRASH_RECOVERY" });
      results.push(result);
      if (result.status === "MANUAL_RECONCILIATION_REQUIRED") fail("MANUAL_RECONCILIATION_REQUIRED", "an incomplete stack transaction requires manual reconciliation");
    }
    return Object.freeze(results);
  }

  async rollbackCommitted(transactionIds, { terminatePi = false, failureCode = "EXPLICIT_STACK_ROLLBACK" } = {}) {
    if (!Array.isArray(transactionIds) || transactionIds.length === 0 || transactionIds.some((value) => typeof value !== "string")) {
      fail("STACK_ROLLBACK_PLAN_INVALID", "stack rollback requires at least one reviewed transaction id");
    }
    await this.recoverPending();
    const processes = await this.processAdmission?.plan?.() ?? [];
    if (processes.length > 0) {
      if (!terminatePi) fail("PI_TERMINATION_AUTHORITY_REQUIRED", "running Pi processes require explicit --terminate-pi authority");
      await this.processAdmission.terminate(processes, { authorized: true });
    }
    const results = [];
    for (const transactionId of transactionIds) {
      const journal = await readStackJournal(this.layout, transactionId);
      if (journal.status !== "COMMITTED") fail("STACK_ROLLBACK_TRANSACTION_INVALID", "reviewed stack transaction is not committed");
      const result = await this.recoverTransaction(transactionId, { failureCode });
      if (result.status !== "ROLLED_BACK") fail("MANUAL_RECONCILIATION_REQUIRED", "stack rollback did not reach a verified terminal state");
      results.push(result);
    }
    return Object.freeze({ ok: true, status: "ROLLED_BACK", mutation: true, transactionIds: Object.freeze([...transactionIds]), results: Object.freeze(results) });
  }

  async recoverTransaction(transactionId, { failureCode = "AUTOMATIC_RECOVERY" } = {}) {
    const journal = await readStackJournal(this.layout, transactionId);
    if (["ROLLED_BACK", "MANUAL_RECONCILIATION_REQUIRED"].includes(journal.status)) return Object.freeze({ status: journal.status, transactionId });
    await markStackJournal(this.layout, transactionId, { status: "RECOVERING", failureCode });
    const paths = stackTransactionLayout(this.layout, transactionId);
    let rollback;
    try { rollback = JSON.parse(await fs.readFile(paths.rollback, "utf8")); }
    catch {
      if (journal.phase === "PREPARED" || journal.phase === "PAYLOADS_VERIFIED" || journal.phase === "BACKUP_DURABLE") {
        await markStackJournal(this.layout, transactionId, { status: "ROLLED_BACK", failureCode });
        return Object.freeze({ ok: true, status: "ROLLED_BACK", transactionId });
      }
      await markStackJournal(this.layout, transactionId, { status: "MANUAL_RECONCILIATION_REQUIRED", failureCode: "ROLLBACK_MANIFEST_MISSING" });
      return Object.freeze({ ok: false, status: "MANUAL_RECONCILIATION_REQUIRED", transactionId });
    }
    const currentSettings = await readFileSnapshot(this.layout.settingsFile);
    if (rollback.targetSettingsDigest && currentSettings.digest !== rollback.targetSettingsDigest && currentSettings.digest !== rollback.settings.digest) {
      await markStackJournal(this.layout, transactionId, { status: "MANUAL_RECONCILIATION_REQUIRED", failureCode: "CONCURRENT_TARGETED_SETTINGS_CHANGE" });
      return Object.freeze({ ok: false, status: "MANUAL_RECONCILIATION_REQUIRED", transactionId });
    }
    await restoreLink(this.layout.ompShim, rollback.ompShim);
    await restoreLink(this.layout.piShim, rollback.piShim);
    await restoreLink(this.layout.currentStack, rollback.currentStack);
    await restoreLink(this.layout.lkgStack, rollback.lkgStack);
    if (rollback.settings.exists) await atomicWriteBytes(this.layout.settingsFile, Buffer.from(rollback.settings.contentBase64, "base64"));
    else await fs.rm(this.layout.settingsFile, { force: true });
    if (rollback.state.exists) await atomicWriteBytes(this.layout.stateFile, Buffer.from(rollback.state.contentBase64, "base64"));
    else await fs.rm(this.layout.stateFile, { force: true });
    if (rollback.externalSwitchRequired) {
      const current = await lstatOrNull(this.layout.npmRoot);
      if (current) await fs.rm(this.layout.npmRoot, { recursive: true, force: true });
      if (await lstatOrNull(paths.externalBackup)) await fs.rename(paths.externalBackup, this.layout.npmRoot);
    }
    await this.harness?.rollback?.({ transactionId, rollback });
    await fs.rm(paths.stage, { recursive: true, force: true });
    await fs.rm(paths.externalStage, { recursive: true, force: true });
    const target = stackPath(this.layout, journal.stackId);
    const currentTarget = await fs.realpath(this.layout.currentStack).catch(() => null);
    if (currentTarget !== target) await fs.rm(target, { recursive: true, force: true });
    await markStackJournal(this.layout, transactionId, { status: "ROLLED_BACK", failureCode });
    const result = { ok: true, status: "ROLLED_BACK", transactionId };
    await writeStackJson(paths.receipt, { ...receipt({ transactionId, plan: JSON.parse(await fs.readFile(paths.plan, "utf8")), stack: { stackId: journal.stackId } }, "ROLLED_BACK", failureCode), ...result });
    return Object.freeze(result);
  }
}

export function createStackTransactionEngine(options) {
  return new StackTransactionEngine(options);
}
