import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createNodeExecAdapter, createProjectGateService } from "../project-gates/index.mjs";
import { captureWorkspaceBaseline } from "./workspace.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const authorized = (ctx, isHostAuthorized) => (ctx?.mode === "tui" && ctx.isProjectTrusted?.() === true)
  || (ctx?.mode === "rpc" && ctx.hasUI === true && isHostAuthorized?.(ctx) === true);

/** Runtime-owned results, never a receipt supplied by a writer or reviewer. */
export function createWriterVerification({ configRoot, getContext, isHostAuthorized, exec = createNodeExecAdapter(), createService = createProjectGateService } = {}) {
  return async ({ cloneRoot, patch, requestedVerification, signal }) => {
    const ctx = getContext();
    if (!authorized(ctx, isHostAuthorized) || typeof ctx.ui?.confirm !== "function") {
      return { status: "BLOCKED", code: "WRITER_GATE_TRUST_REQUIRED" };
    }
    const isContextTrusted = () => getContext() === ctx && authorized(ctx, isHostAuthorized);
    const parent = createService({ configRoot, getContext: () => ctx, exec, isContextTrusted });
    const clone = createService({ configRoot, getContext: () => ({ ...ctx, cwd: cloneRoot }), exec, isContextTrusted });
    try {
      const original = await parent.plan(null, { signal });
      const plan = await clone.plan(null, { signal });
      if (original.binding.head !== patch.baseCommit || plan.binding.head !== patch.baseCommit || original.binding.manifestDigest !== plan.binding.manifestDigest) {
        return { status: "BLOCKED", code: "WRITER_GATE_MANIFEST_DRIFT" };
      }
      const description = [
        `Requested verification: ${JSON.stringify(requestedVerification)}`,
        `Patch: ${patch.sha256}`,
        ...plan.gates.map((gate) => JSON.stringify({ id: gate.id, executable: gate.executableRealpath, args: gate.args, cwd: gate.cwd, env: gate.env, timeoutSeconds: gate.timeoutSeconds })),
        "These exact project processes run in the managed clone with a scrubbed environment. This is an execution allowlist, NOT a filesystem or network sandbox. They may generate build artifacts. Decline to retain the patch without integration.",
      ].join("\n");
      if (!await ctx.ui.confirm("Run clone verification before integrating this patch?", description)) return { status: "BLOCKED", code: "WRITER_GATE_DENIED" };
      if (signal?.aborted) return { status: "BLOCKED", code: "WRITER_GATE_CANCELLED" };
      if (!isContextTrusted()) return { status: "BLOCKED", code: "WRITER_GATE_TRUST_REQUIRED" };
      await clone.grant(plan, { signal });
      const results = [];
      for (const gate of plan.gates) {
        if (signal?.aborted) return { status: "BLOCKED", code: "WRITER_GATE_CANCELLED" };
        const result = await clone.run(gate.id, { signal });
        results.push(result);
        if (result.status !== "PASS" || result.exitCode !== 0 || result.killed !== false) break;
      }
      const passed = !signal?.aborted && results.length === plan.gates.length && results.every((result) => result.status === "PASS" && result.exitCode === 0 && result.killed === false);
      const receipt = {
        formatVersion: 1,
        kind: "omp-writer-verification",
        status: passed ? "PASS" : "FAIL",
        patchDigest: patch.sha256,
        baseCommit: patch.baseCommit,
        cloneRootDigest: digest(cloneRoot),
        manifestDigest: plan.binding.manifestDigest,
        bindingDigest: plan.binding.bindingDigest,
        results,
      };
      return Object.freeze({ ...receipt, receiptDigest: digest(JSON.stringify(receipt)) });
    } catch (error) {
      if (signal?.aborted || error?.code === "PROJECT_GATE_CANCELLED") return { status: "BLOCKED", code: "WRITER_GATE_CANCELLED" };
      return { status: "BLOCKED", code: error.code === "ENOENT" ? "WRITER_GATE_MANIFEST_REQUIRED" : "WRITER_GATE_EXECUTION_ERROR" };
    } finally {
      await parent.dispose();
      await clone.dispose();
    }
  };
}

/** A separate approval and receipt for checks in the worktree that received the patch. */
export function createRealWorkspaceVerification({ configRoot, getContext, isHostAuthorized, exec = createNodeExecAdapter(), createService = createProjectGateService, captureBaseline = captureWorkspaceBaseline } = {}) {
  return async ({ repositoryRoot, patch, runId, cloneManifestDigest, signal }) => {
    const ctx = getContext();
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    if (!authorized(ctx, isHostAuthorized) || typeof ctx.ui?.confirm !== "function" || typeof sessionId !== "string" || !sessionId) return { status: "BLOCKED", code: "WRITER_REAL_GATE_TRUST_REQUIRED" };
    const root = await fs.realpath(repositoryRoot);
    if (await fs.realpath(ctx.cwd) !== root || !Array.isArray(patch?.changedPaths) || patch.changedPaths.length === 0 || patch.changedPaths.length > 64) return { status: "BLOCKED", code: "WRITER_REAL_GATE_INPUT_INVALID" };
    const identityCurrent = async () => {
      const current = getContext();
      return current?.sessionManager?.getSessionId?.() === sessionId && await fs.realpath(current?.cwd ?? "").catch(() => null) === root && authorized(current, isHostAuthorized);
    };
    const sourceSnapshot = async (fixed = null) => {
      const baseline = await captureBaseline({ cwd: root, runGit: (cwd, args) => exec("git", args, { cwd, signal, timeout: 10_000 }) });
      if (baseline.status !== "GIT_REPOSITORY" || baseline.head !== patch.baseCommit) return null;
      const tracked = await exec("git", ["ls-files", "-z", "--cached"], { cwd: root, signal, timeout: 10_000, encoding: "buffer" });
      const untracked = await exec("git", ["ls-files", "-z", "--others", "--exclude-standard"], { cwd: root, signal, timeout: 10_000, encoding: "buffer" });
      if ([tracked, untracked].some((entry) => entry.code !== 0 || entry.killed || entry.terminationUnconfirmed || entry.outputLimitExceeded)) return null;
      const trackedPaths = Buffer.from(tracked.stdout).toString("utf8").split("\0").filter(Boolean).sort();
      const untrackedPaths = Buffer.from(untracked.stdout).toString("utf8").split("\0").filter(Boolean).sort();
      const generated = (name) => /^(?:coverage|dist|build|node_modules|\.next|\.cache)\//u.test(name);
      if (fixed && (JSON.stringify(trackedPaths) !== JSON.stringify(fixed.trackedPaths) || untrackedPaths.some((name) => !fixed.paths.includes(name) && !generated(name)))) return null;
      const paths = fixed?.paths ?? [...new Set([...trackedPaths, ...untrackedPaths, ...patch.changedPaths, ".pi/only-my-pi-gates.json"])].sort();
      if (paths.length > 10_000) return null;
      const entries = [];
      let totalBytes = 0;
      for (const relative of paths) {
        if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) return null;
        const filename = path.join(root, relative);
        let stat;
        try { stat = await fs.lstat(filename); } catch (error) { if (error?.code === "ENOENT") { entries.push([relative, "missing", null]); continue; } throw error; }
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return null;
        totalBytes += stat.size;
        if (totalBytes > 128 * 1024 * 1024) return null;
        entries.push([relative, "file", stat.mode & 0o777, digest(await fs.readFile(filename))]);
      }
      return { paths, trackedPaths, scopeDigest: digest(JSON.stringify({ paths, trackedPaths })), sourceDigest: digest(JSON.stringify(entries)) };
    };
    const service = createService({ configRoot, getContext, exec, isContextTrusted: (current) => authorized(current, isHostAuthorized) });
    let outcome;
    try {
      outcome = await (async () => {
      const plan = await service.plan(null, { projectRoot: root, signal });
      if (plan.binding.head !== patch.baseCommit || (cloneManifestDigest && plan.binding.manifestDigest !== cloneManifestDigest)) return { status: "BLOCKED", code: "WRITER_REAL_GATE_MANIFEST_DRIFT" };
      const before = await sourceSnapshot();
      if (!before) return { status: "BLOCKED", code: "WRITER_REAL_SOURCE_UNVERIFIABLE" };
      const applied = await exec("git", ["apply", "--reverse", "--check", patch.patchPath], { cwd: root, signal, timeout: 10_000 });
      const patchBytes = await fs.readFile(patch.patchPath);
      if (applied.code !== 0 || applied.killed || applied.terminationUnconfirmed || digest(patchBytes) !== patch.sha256) return { status: "BLOCKED", code: "WRITER_REAL_PATCH_DRIFT" };
      const description = [
        `Patch: ${patch.sha256}`,
        ...plan.gates.map((gate) => JSON.stringify({ id: gate.id, executable: gate.executableRealpath, args: gate.args, cwd: gate.cwd, env: gate.env, timeoutSeconds: gate.timeoutSeconds })),
        "These processes run in the real worktree after the patch was applied. This is a separate approval from clone verification. Process allowlisting is NOT a filesystem or network sandbox.",
      ].join("\n");
      if (!await ctx.ui.confirm("Run verification in the real worktree?", description)) return { status: "BLOCKED", code: "WRITER_REAL_GATE_DENIED" };
      if (signal?.aborted || !await identityCurrent()) return { status: "BLOCKED", code: "WRITER_REAL_GATE_CANCELLED" };
      await service.grant(plan, { signal });
      const results = [];
      for (const gate of plan.gates) {
        if (signal?.aborted || !await identityCurrent()) return { status: "BLOCKED", code: "WRITER_REAL_GATE_CANCELLED" };
        const result = await service.run(gate.id, { signal });
        results.push(result);
        if (result.status !== "PASS" || result.exitCode !== 0 || result.killed !== false || result.terminationUnconfirmed === true) break;
      }
      const afterPlan = await service.plan(plan.binding.gateIds, { projectRoot: root, signal });
      const after = await sourceSnapshot(before);
      if (!await identityCurrent() || signal?.aborted) return { status: "BLOCKED", code: "WRITER_REAL_GATE_CANCELLED" };
      if (afterPlan.binding.bindingDigest !== plan.binding.bindingDigest || after?.sourceDigest !== before.sourceDigest || after?.scopeDigest !== before.scopeDigest) return { status: "BLOCKED", code: "WRITER_REAL_GATE_DRIFT" };
      const passed = results.length > 0 && results.length === plan.gates.length && results.every((result, index) => result.status === "PASS" && result.exitCode === 0 && result.killed === false && result.terminationUnconfirmed !== true && result.bindingDigest === plan.binding.bindingDigest && result.tupleDigest === plan.gates[index].tupleDigest);
      const receipt = { formatVersion: 1, kind: "omp-real-workspace-verification", phase: "real-workspace", status: passed ? "PASS" : "FAIL", runId, patchDigest: patch.sha256, repositoryRootDigest: digest(root), head: patch.baseCommit, manifestDigest: plan.binding.manifestDigest, bindingDigest: plan.binding.bindingDigest, sourceScopeDigest: before.scopeDigest, sourceDigest: before.sourceDigest, results };
      return Object.freeze({ ...receipt, receiptDigest: digest(JSON.stringify(receipt)) });
      })();
    } catch (error) {
      outcome = { status: "BLOCKED", code: signal?.aborted || error?.code === "PROJECT_GATE_CANCELLED" ? "WRITER_REAL_GATE_CANCELLED" : error?.code === "ENOENT" ? "WRITER_REAL_GATE_MANIFEST_REQUIRED" : "WRITER_REAL_GATE_EXECUTION_ERROR" };
    } finally {
      const disposed = await service.dispose();
      if (disposed.terminationUnconfirmed) outcome = { status: "BLOCKED", code: "WRITER_REAL_TERMINATION_UNCONFIRMED" };
    }
    if (outcome?.status === "PASS" && (signal?.aborted || !await identityCurrent())) return { status: "BLOCKED", code: "WRITER_REAL_GATE_CANCELLED" };
    return outcome;
  };
}
