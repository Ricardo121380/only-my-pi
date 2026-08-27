import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentTemplate, createResolvedAgentSpec, createTaskAssignment, digestValue } from "../packages/subagents/domain/index.mjs";
import { assertWriterClaimIsolation, createWriterHandoff, validateIntegrationHandoff } from "../packages/subagents/policy/writer-handoff.mjs";
import { createArtifactStore } from "../packages/subagents/state/artifact-store.mjs";
import { createSchemaRegistry } from "../scripts/lib/schema-registry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function writerSpec() {
  const template = createAgentTemplate({
    id: "implementer",
    version: "1.0.0",
    backendAgentId: "omp-implementer",
    sourceHash: digestValue("source"),
    promptHash: digestValue("prompt"),
    tools: { allow: ["edit", "read", "write"], deny: [] },
    requiredCapabilities: ["workspace-read"],
    policyCeiling: {
      workspace: "managed-worktree",
      mutation: "guarded",
      approval: "ask",
      egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "deep",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    writer: true,
    continuable: true,
    resumable: true,
    timeoutMs: 10_000,
    redaction: {},
  });
  return createResolvedAgentSpec({ template, id: "writer-spec" });
}

function assignment(id, fileClaims) {
  return createTaskAssignment({
    assignmentId: id,
    agentSpec: writerSpec(),
    task: { text: `implement ${id}` },
    ownership: {
      writer: true,
      workspace: "managed-worktree",
      allowedPaths: ["src"],
      fileClaims,
      baseCommit: "a".repeat(40),
    },
    idempotency: { class: "side-effect" },
    context: { mode: "fresh", artifactRefs: [] },
    output: { type: "object" },
  });
}

test("ArtifactStore publishes immutable run-scoped bytes and verifies digest, size, and symlink containment", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "omp-artifacts-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "artifacts");
  const store = createArtifactStore({ rootDir: root, filesystem: fs, maxArtifactBytes: 1024 });
  const publication = {
    id: "review-report",
    mediaType: "application/json",
    contents: JSON.stringify({ verdict: "pass" }),
    producer: { runId: "run-one", revision: 0, nodeId: "review", attemptId: "attempt-one" },
    provenance: { sourceDigest: digestValue("source"), policyDigest: digestValue("policy"), redaction: "bounded" },
  };
  const ref = await store.publish(publication);
  assert.equal(createSchemaRegistry({ rootDir: repositoryRoot }).validate("artifactRef", ref).valid, true);
  assert.equal(ref.storage.relativePath.startsWith("runs/run-one/"), true);
  assert.deepEqual(JSON.parse((await store.read(ref)).toString("utf8")), { verdict: "pass" });
  assert.deepEqual(await store.publish(publication), ref);
  await assert.rejects(store.read(ref, { maxBytes: 1 }), (error) => error?.code === "ARTIFACT_TOO_LARGE");

  const target = path.join(root, ...ref.storage.relativePath.split("/"));
  await fs.writeFile(target, "tampered", "utf8");
  await assert.rejects(store.read(ref), (error) => error?.code === "ARTIFACT_DIGEST_MISMATCH");

  await fs.rm(path.join(root, "runs", "run-one"), { recursive: true, force: true });
  const escaped = path.join(parent, "escaped");
  await fs.mkdir(escaped);
  await fs.symlink(escaped, path.join(root, "runs", "run-one"));
  await assert.rejects(store.publish({ ...publication, contents: "new" }), (error) => error?.code === "ARTIFACT_PATH_ESCAPE");
});

test("writer handoff requires exact managed-worktree claims, parent diff enforcement, terminal proof, and passing gates", () => {
  const task = assignment("writer-a", ["src/feature"]);
  const handoff = createWriterHandoff({
    assignment: task,
    changedPaths: ["src/feature/index.mjs", "src/feature/test.mjs"],
    patchDigest: digestValue("patch"),
    pathEnforcement: { state: "ENFORCED", mechanism: "parent-diff-verification", receiptDigest: digestValue("diff-proof") },
    terminalReceipt: { outcome: "completed", authoritative: true, receiptId: digestValue("terminal") },
    gateReceipts: [
      { gateId: "test-contract", status: "PASS", receiptDigest: digestValue("test") },
      { gateId: "test-integration", status: "PASS", receiptDigest: digestValue("integration") },
    ],
    artifactRefs: ["patch-artifact"],
  });
  assert.equal(handoff.integration.automatic, false);
  assert.equal(handoff.integration.state, "HANDOFF_ONLY");
  const verdict = validateIntegrationHandoff(handoff, {
    currentBaseCommit: "a".repeat(40),
    requiredGateIds: ["test-contract", "test-integration"],
  });
  assert.equal(verdict.status, "READY_FOR_PARENT_INTEGRATION");
  assert.equal(verdict.automaticIntegration, false);

  assert.throws(
    () => createWriterHandoff({
      assignment: task,
      changedPaths: ["secrets/private.txt"],
      patchDigest: digestValue("patch"),
      pathEnforcement: { state: "ENFORCED", mechanism: "parent-diff-verification", receiptDigest: digestValue("diff-proof") },
      terminalReceipt: { outcome: "completed", authoritative: true, receiptId: digestValue("terminal") },
      gateReceipts: [],
    }),
    (error) => error?.code === "WRITER_CHANGED_PATH_OUTSIDE_CLAIMS",
  );
  assert.throws(
    () => createWriterHandoff({
      assignment: task,
      changedPaths: ["src/feature/index.mjs"],
      patchDigest: digestValue("patch"),
      pathEnforcement: { state: "UNAVAILABLE", mechanism: "pi-subagents-v1", receiptDigest: digestValue("no-proof") },
      terminalReceipt: { outcome: "completed", authoritative: true, receiptId: digestValue("terminal") },
      gateReceipts: [],
    }),
    (error) => error?.code === "WRITER_PATH_ENFORCEMENT_UNAVAILABLE",
  );
  assert.throws(
    () => validateIntegrationHandoff(handoff, { currentBaseCommit: "b".repeat(40), requiredGateIds: ["test-contract"] }),
    (error) => error?.code === "WRITER_BASE_COMMIT_DRIFT",
  );
  assert.throws(
    () => createWriterHandoff({
      assignment: task,
      changedPaths: ["src/feature/index.mjs"],
      patchDigest: digestValue("patch"),
      pathEnforcement: { state: "ENFORCED", mechanism: "parent-diff-verification", receiptDigest: digestValue("diff-proof") },
      terminalReceipt: { outcome: "completed", authoritative: true, receiptId: digestValue("terminal") },
      gateReceipts: [],
      artifactRefs: ["../../secret"],
    }),
    TypeError,
  );
});

test("two writers with the same or prefix-overlapping file claim fail closed before dispatch", () => {
  const first = assignment("writer-one", ["src/shared"]);
  const second = assignment("writer-two", ["src/shared/file.mjs"]);
  assert.throws(
    () => assertWriterClaimIsolation([first, second]),
    (error) => error?.code === "WRITER_CLAIM_CONFLICT",
  );
  const isolated = assignment("writer-three", ["src/isolated"]);
  assert.equal(assertWriterClaimIsolation([first, isolated]).ok, true);
});
