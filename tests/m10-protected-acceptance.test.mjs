import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { M8_LIVE_EXPECTED_ASSERTIONS } from "../scripts/m8-live-acceptance.mjs";
import {
  createM10P10Evidence,
  createM10P9Evidence,
  executeM10ProtectedAcceptance,
  m10ProtectedCliEnvironment,
  parseM10ProtectedAcceptanceArgs,
  validateM10ArtifactArchiveListing,
} from "../scripts/m10-protected-acceptance.mjs";
import {
  M9_LIVE_CANDIDATE,
  M9_LIVE_PRICING,
  M9_LIVE_RECORD_TYPE,
} from "../packages/subagents/release/m9-live-acceptance-extension.mjs";

const sourceCommit = "a".repeat(40);
const sha = (character) => `sha256:${character.repeat(64)}`;
const output = (name) => path.resolve(`verification/protected/${name}.json`);

function inspected() {
  return {
    bundle: { sha256: sha("1") },
    manifest: {
      manifestDigest: sha("2"),
      onlyMyPiArtifact: { sha256: sha("3") },
      candidateGraphDigest: sha("4"),
    },
  };
}

test("M10 protected runner is plan-first and separates migration, Pi termination, and Web authority", () => {
  assert.equal(parseM10ProtectedAcceptanceArgs(["--plan", "--json"]).operation, "plan");
  assert.throws(() => parseM10ProtectedAcceptanceArgs(["--run"]), { code: "M10_PROTECTED_CONFIRMATION_REQUIRED" });
  assert.throws(() => parseM10ProtectedAcceptanceArgs(["--plan", "--yes"]), { code: "M10_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM10ProtectedAcceptanceArgs(["--run", "--plan"]), { code: "M10_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM10ProtectedAcceptanceArgs(["--plan", "--bundle", "relative"]), { code: "M10_PROTECTED_ARGUMENT_INVALID" });
  const run = parseM10ProtectedAcceptanceArgs([
    "--run", "--yes", "--terminate-pi", "--authorize-web", "--json",
    "--bundle", "/tmp/m10-bundle.json",
    "--source-commit", sourceCommit,
    "--p9-output", output("m10-p9-fixture"),
    "--p10-output", output("m10-p10-fixture"),
  ]);
  assert.equal(run.operation, "run");
  assert.equal(run.terminatePi, true);
  assert.equal(run.authorizeWeb, true);
});

test("M10 protected plan performs no migration or Provider request", async () => {
  const args = parseM10ProtectedAcceptanceArgs(["--plan"]);
  const result = await executeM10ProtectedAcceptance(args);
  assert.equal(result.mutation, false);
  assert.equal(result.plan.writes, 0);
  assert.equal(result.plan.providerRequests, 0);
  assert.equal(result.plan.authorization.writer, "DENIED");
});

test("M10 protected child processes inherit only the bounded non-credential environment", () => {
  const environment = m10ProtectedCliEnvironment();
  assert.equal(environment.HOME, process.env.HOME);
  assert.equal(environment.PI_TELEMETRY, "0");
  for (const key of Object.keys(environment)) {
    assert.doesNotMatch(key, /KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH/u);
  }
});

test("M10 protected artifact extraction accepts only regular package-relative archive names", () => {
  assert.doesNotThrow(() => validateM10ArtifactArchiveListing("package/\npackage/bin/omp.mjs\n"));
  assert.throws(() => validateM10ArtifactArchiveListing(""), { code: "M10_PROTECTED_ARTIFACT_INVALID" });
  assert.throws(() => validateM10ArtifactArchiveListing("../outside\n"), { code: "M10_PROTECTED_ARTIFACT_INVALID" });
  assert.throws(() => validateM10ArtifactArchiveListing("package/../outside\n"), { code: "M10_PROTECTED_ARTIFACT_INVALID" });
});

test("P9 evidence binds exact rollback and reapply without exposing local values", () => {
  const before = {
    preflight: {
      settings: { digest: sha("5") },
      generation: { generationId: sha("6"), lkgGenerationId: sha("6") },
      pi: { version: "0.84.1", treeDigest: sha("7") },
      external: { lockDigest: sha("8"), npmTreeDigest: sha("9") },
      ownership: { owner: "user" },
      privacy: { authRead: false },
    },
    piProcesses: [{ executableClass: "PI_PARENT", identityDigest: sha("a") }],
    processPolicy: { signal: "SIGTERM", timeoutSeconds: 15, forceKill: false },
  };
  const journal = { status: "COMMITTED", history: [{ phase: "NO_MODEL_SMOKE_PASSED" }] };
  const evidence = createM10P9Evidence({
    sourceCommit,
    inspected: inspected(),
    before,
    firstApply: { status: "COMMITTED", transactionId: "tx-1" },
    firstJournal: journal,
    rollbackJournal: { status: "ROLLED_BACK" },
    rollbackPlan: structuredClone(before),
    cliAbsent: true,
    reapply: { status: "COMMITTED", transactionId: "tx-2" },
    reapplyJournal: journal,
    createdAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(evidence.gateId, "P9");
  assert.equal(evidence.assertions.length, 12);
  assert.equal(JSON.stringify(evidence).includes("tx-1"), false);
});

function liveRecords() {
  const raw = M8_LIVE_EXPECTED_ASSERTIONS.filter((id) => id !== "artifact-identity");
  const assertions = raw.map((id, index) => ({ id, status: "PASS", digest: sha(String((index % 9) + 1)) }));
  const common = {
    formatVersion: 1,
    type: M9_LIVE_RECORD_TYPE,
    status: "PASS",
    sourceCommit,
    model: { provider: "cc-switch-open-code-go", id: "deepseek-v4-flash" },
    candidate: M9_LIVE_CANDIDATE,
    pricing: M9_LIVE_PRICING,
    candidateAuditDigest: sha("b"),
    candidateContractDigest: sha("c"),
  };
  return {
    main: { ...common, phase: "main", assertions: assertions.filter((entry) => entry.id !== "resume-across-session"), usage: { tokens: 20_000, costUsd: 0, toolCalls: 3, meteredTerminals: 2 } },
    resume: { ...common, phase: "resume", assertions: assertions.filter((entry) => entry.id === "resume-across-session"), usage: { tokens: 0, costUsd: 0, toolCalls: 0, meteredTerminals: 0 } },
  };
}

test("P10 evidence maps the existing live matrix to M10 identities and fixed-subscription metering", () => {
  const records = liveRecords();
  const identity = {
    generationId: sha("4"),
    bindings: [{ id: "subagents", version: "0.57.0" }],
    version: { sourceCommit, artifactSha256: sha("3"), installedGenerationId: sha("4"), piVersion: "0.84.3", subagentsVersion: "0.57.0" },
    doctor: { generation: { status: "VERIFIED", alignment: "MATCH" } },
  };
  const evidence = createM10P10Evidence({ sourceCommit, inspected: inspected(), ...records, identity, piList: { packageCount: 10, listingDigest: sha("d") }, wallSeconds: 120, createdAt: "2026-08-28T00:00:00.000Z" });
  assert.equal(evidence.gateId, "P10");
  assert.equal(evidence.assertions.length, 17);
  assert.deepEqual(evidence.usage, { directlyMeteredTokens: 20_000, variableCostUsd: 0, wallSeconds: 120, toolCalls: 3, meteredTerminals: 2 });
  assert.equal(evidence.pricing.fixedFeeIncludedInRunCost, false);

  records.main.sourceCommit = "b".repeat(40);
  assert.throws(() => createM10P10Evidence({ sourceCommit, inspected: inspected(), ...records, identity, piList: { packageCount: 10 }, wallSeconds: 1, createdAt: "2026-08-28T00:00:00.000Z" }), { code: "M10_PROTECTED_LIVE_RECORD_INVALID" });
});
