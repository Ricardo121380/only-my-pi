import { createHash } from "node:crypto";
import { createNodeExecAdapter, createProjectGateService } from "../project-gates/index.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

/** Runtime-owned results, never a receipt supplied by a writer or reviewer. */
export function createWriterVerification({ configRoot, getContext, exec = createNodeExecAdapter(), createService = createProjectGateService } = {}) {
  return async ({ cloneRoot, patch, requestedVerification, signal }) => {
    const ctx = getContext();
    if (ctx?.mode !== "tui" || ctx.isProjectTrusted?.() !== true || typeof ctx.ui?.confirm !== "function") {
      return { status: "BLOCKED", code: "WRITER_GATE_TRUST_REQUIRED" };
    }
    const parent = createService({ configRoot, getContext: () => ctx, exec });
    const clone = createService({ configRoot, getContext: () => ({ ...ctx, cwd: cloneRoot }), exec });
    try {
      const original = await parent.plan();
      const plan = await clone.plan();
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
      if (getContext() !== ctx || ctx.isProjectTrusted?.() !== true) return { status: "BLOCKED", code: "WRITER_GATE_TRUST_REQUIRED" };
      await clone.grant(plan);
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
      return { status: "BLOCKED", code: error.code === "ENOENT" ? "WRITER_GATE_MANIFEST_REQUIRED" : "WRITER_GATE_EXECUTION_ERROR" };
    } finally {
      await parent.dispose();
      await clone.dispose();
    }
  };
}
