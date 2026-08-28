import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPiSubagentsLiveProbeEvidence,
  PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ACTIVE_TOOLS,
  PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ARTIFACT,
  PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_PI_VERSION,
} from "../packages/subagents/live-probe.mjs";

import {
  inspectM9CandidateInstallation,
  loadUpstreamCompatibility,
  M9_EXPECTED_PACKAGES,
  M9_REQUIRED_SCOPES,
  upstreamCompatibilityDigest,
  UpstreamCompatibilityError,
  validateUpstreamCompatibility,
} from "../packages/upstream-compatibility/index.mjs";
import {
  assertM9WebSafetyEvidence,
  runM9WebSafetyProbe,
} from "../packages/upstream-compatibility/web-safety.mjs";
import { assertM9StackProbeEvidence } from "../packages/upstream-compatibility/stack-probe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureInstallation(root, contract) {
  const packages = {};
  for (const entry of contract.candidate.packages) {
    const relativeRoot = `node_modules/${entry.name}`;
    const packageRoot = path.join(root, ...relativeRoot.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
      name: entry.name,
      version: entry.version,
      scripts: { test: "node --test" },
    }, null, 2)}\n`);
    for (const relativeEntry of entry.requiredEntrypoints) {
      const file = path.join(packageRoot, ...relativeEntry.split("/"));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "export {};\n");
    }
    packages[relativeRoot] = {
      version: entry.version,
      resolved: `https://registry.npmjs.org/${entry.name}/-/${entry.id}-${entry.version}.tgz`,
      integrity: entry.integrity,
    };
  }
  await fs.writeFile(path.join(root, "package-lock.json"), `${JSON.stringify({
    name: "only-my-pi-m9-fixture",
    lockfileVersion: 3,
    packages,
  }, null, 2)}\n`);
}

test("M9 contract preserves its baseline and exact candidate provenance after M10 promotion", () => {
  const contract = loadUpstreamCompatibility({ rootDir: ROOT });
  assert.equal(contract.contractDigest, upstreamCompatibilityDigest(contract));
  assert.deepEqual(contract.candidate.packages.map((entry) => entry.id), M9_EXPECTED_PACKAGES.map((entry) => entry.id));
  assert.deepEqual(Object.keys(contract.scopes).sort(), [...M9_REQUIRED_SCOPES].sort());
  assert.equal(contract.decision.state, "PROMOTE");
  assert.equal(contract.decision.defaultPiVersion, contract.candidate.piVersion);
  assert.equal(contract.decision.defaultSubagentsVersion, contract.candidate.subagentsVersion);
  assert.equal(contract.scopes.noModelRpc.status, "PASS");
  assert.equal(contract.scopes.liveReadOnlyMatrix.status, "PASS");
  assert.equal(contract.decision.reasonCode, "M10_REAL_ROOT_AND_LIVE_ACCEPTANCE_PASSED");
  assert.doesNotThrow(() => validateUpstreamCompatibility(contract, { rootDir: ROOT, verifyEvidencePaths: true }));
});

test("checked-in M9 no-model evidence is digest-bound to Pi 0.84.3 and pi-subagents 0.57.0", async () => {
  const evidence = JSON.parse(await fs.readFile(path.join(
    ROOT,
    "verification",
    "evidence",
    "m9-pi-0.84.3-subagents-0.57.0-no-model.json",
  ), "utf8"));
  const verified = assertPiSubagentsLiveProbeEvidence(evidence, {
    expectedArtifact: PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ARTIFACT,
    expectedPiVersion: PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_PI_VERSION,
    expectedActiveTools: PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ACTIVE_TOOLS,
  });
  assert.equal(verified.realPiHome, "NOT_TOUCHED");
  assert.equal(verified.providerRequest, "NOT_RUN_BY_POLICY");
  assert.equal(verified.childDispatch, "NOT_REQUESTED");
});

test("checked-in U9 completion receipt is bound to the protected evidence-only commit", async () => {
  const evidence = JSON.parse(await fs.readFile(path.join(
    ROOT,
    "verification",
    "protected",
    "2026-08-28-m9-candidate-live-readonly-matrix.json",
  ), "utf8"));
  const receipt = JSON.parse(await fs.readFile(path.join(
    ROOT,
    "verification",
    "receipts",
    "2026-08-28-m9-upstream-compatibility.json",
  ), "utf8"));
  const u9 = receipt.gates.find((gate) => gate.id === "U9");
  assert.equal(receipt.status, "COMPLETE");
  assert.equal(receipt.sourceCommit, evidence.sourceCommit);
  assert.equal(receipt.executionCommit, "2af92de9f701d305f7263aeecec017b7c10bd696");
  assert.equal(receipt.evidenceCommit, receipt.executionCommit);
  assert.equal(receipt.contract.digest, evidence.artifacts.contractDigest);
  assert.deepEqual(receipt.summary, {
    required: 9,
    deterministic: 8,
    deterministicPassed: 8,
    protected: 1,
    protectedPassed: 1,
    protectedNotRunByPolicy: 0,
  });
  assert.equal(u9.status, "PASS");
  assert.equal(u9.evidence.evidenceDigest, evidence.evidenceDigest);
  assert.equal(u9.evidence.assertionCount, 17);
});

test("M9 contract rejects premature promotion, candidate package drift, and Stable default drift", () => {
  const contract = structuredClone(loadUpstreamCompatibility({ rootDir: ROOT }));
  contract.scopes.liveReadOnlyMatrix.status = "NOT_RUN_BY_POLICY";
  contract.decision.state = "PROMOTE";
  contract.decision.defaultPiVersion = contract.candidate.piVersion;
  contract.decision.defaultSubagentsVersion = contract.candidate.subagentsVersion;
  contract.contractDigest = upstreamCompatibilityDigest(contract);
  assert.throws(
    () => validateUpstreamCompatibility(contract),
    (error) => error instanceof UpstreamCompatibilityError && error.code === "PREMATURE_UPSTREAM_PROMOTION",
  );

  const packageDrift = structuredClone(loadUpstreamCompatibility({ rootDir: ROOT }));
  packageDrift.candidate.packages[0].version = "0.5.5";
  packageDrift.contractDigest = upstreamCompatibilityDigest(packageDrift);
  assert.throws(
    () => validateUpstreamCompatibility(packageDrift),
    (error) => error instanceof UpstreamCompatibilityError && error.code === "CANDIDATE_PACKAGE_DRIFT",
  );

  const defaultDrift = structuredClone(loadUpstreamCompatibility({ rootDir: ROOT }));
  defaultDrift.decision.state = "HOLD";
  defaultDrift.decision.reasonCode = "CANDIDATE_PROMOTION_REVIEW_PENDING";
  defaultDrift.decision.defaultPiVersion = defaultDrift.candidate.piVersion;
  defaultDrift.contractDigest = upstreamCompatibilityDigest(defaultDrift);
  assert.throws(
    () => validateUpstreamCompatibility(defaultDrift),
    (error) => error instanceof UpstreamCompatibilityError && error.code === "UNVERIFIED_DEFAULT_VERSION_CHANGE",
  );
});

test("candidate installation audit binds lock integrity, disk identity, entrypoints, and absent install lifecycle scripts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contract = loadUpstreamCompatibility({ rootDir: ROOT });
  await fixtureInstallation(root, contract);
  const audit = inspectM9CandidateInstallation({ installationRoot: root, contract });
  assert.equal(audit.status, "PASS");
  assert.equal(audit.packages.length, 7);
  assert.match(audit.auditDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(audit.packages.flatMap((entry) => entry.installLifecycleScripts), []);

  const lockFile = path.join(root, "package-lock.json");
  const lock = JSON.parse(await fs.readFile(lockFile, "utf8"));
  lock.packages["node_modules/pi-subagents"].integrity = `sha512-${"A".repeat(88)}`;
  await fs.writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  assert.throws(
    () => inspectM9CandidateInstallation({ installationRoot: root, contract }),
    (error) => error instanceof UpstreamCompatibilityError && error.code === "CANDIDATE_LOCK_DRIFT",
  );
});

test("candidate installation audit fails closed on an install lifecycle script", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-lifecycle-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contract = loadUpstreamCompatibility({ rootDir: ROOT });
  await fixtureInstallation(root, contract);
  const manifestFile = path.join(root, "node_modules", "pi-web-access", "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  manifest.scripts.postinstall = "node unexpected.mjs";
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => inspectM9CandidateInstallation({ installationRoot: root, contract }),
    (error) => error instanceof UpstreamCompatibilityError && error.code === "CANDIDATE_LIFECYCLE_SCRIPT",
  );
});

test("candidate installation audit rejects a symlink in required-entrypoint ancestry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-entrypoint-link-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contract = loadUpstreamCompatibility({ rootDir: ROOT });
  await fixtureInstallation(root, contract);
  const packageRoot = path.join(root, "node_modules", "pi-subagents");
  const source = path.join(packageRoot, "src", "api");
  const replacement = path.join(packageRoot, "src", "api-real");
  await fs.rename(source, replacement);
  await fs.symlink("api-real", source, "dir");
  assert.throws(
    () => inspectM9CandidateInstallation({ installationRoot: root, contract }),
    (error) => error instanceof UpstreamCompatibilityError && error.code === "ENTRYPOINT_UNSAFE",
  );
});

test("M9 Web black-box contract requires public control, private-address denial, and redirect revalidation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-web-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contract = loadUpstreamCompatibility({ rootDir: ROOT });
  await fixtureInstallation(root, contract);
  let redirectFetchCalls = 0;
  const evidence = await runM9WebSafetyProbe({
    installationRoot: root,
    contract,
    clock: () => new Date("2026-08-27T00:00:00.000Z"),
    moduleLoader: async () => ({
      async validateRemoteUrl(rawUrl, { lookup }) {
        const url = new URL(rawUrl);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("blocked protocol");
        const hostname = url.hostname.replace(/^\[|\]$/gu, "");
        if (["localhost", "::1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "127.0.0.1"].includes(hostname)) throw new Error("blocked address");
        const addresses = await lookup(hostname);
        if (addresses.some((entry) => entry.address === "169.254.169.254")) throw new Error("blocked resolved address");
        return url;
      },
      async fetchRemoteUrl(rawUrl, _init, options) {
        const current = await this.validateRemoteUrl(rawUrl, options);
        const response = await options.fetch(current);
        redirectFetchCalls += 1;
        await this.validateRemoteUrl(new URL(response.headers.get("location"), current), options);
        return response;
      },
    }),
  });
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.externalNetworkRequests, 0);
  assert.equal(redirectFetchCalls, 1);
  assert.equal(assertM9WebSafetyEvidence(evidence).evidenceDigest, evidence.evidenceDigest);
});

test("checked-in pi-web-access 0.25.0 evidence is digest-bound and made no external request", async () => {
  const evidence = JSON.parse(await fs.readFile(path.join(
    ROOT,
    "verification",
    "evidence",
    "m9-pi-web-access-0.25.0-ssrf.json",
  ), "utf8"));
  const verified = assertM9WebSafetyEvidence(evidence);
  assert.equal(verified.externalNetworkRequests, 0);
  assert.equal(verified.policy.allowBrowserCookies, false);
  assert.equal(verified.policy.authFetch, false);
  assert.equal(verified.cases.every((entry) => entry.status === "PASS"), true);
});

test("checked-in Pi 0.84.3 full-stack evidence proves unique command and tool ownership", async () => {
  const evidence = JSON.parse(await fs.readFile(path.join(
    ROOT,
    "verification",
    "evidence",
    "m9-pi-0.84.3-full-stack-no-model.json",
  ), "utf8"));
  const verified = assertM9StackProbeEvidence(evidence);
  assert.equal(verified.commands.find((entry) => entry.name === "plan").owner, "plan-mode");
  assert.equal(verified.commands.find((entry) => entry.name === "usage").owner, "usage");
  assert.equal(verified.tools.find((entry) => entry.name === "subagent").owner, "subagents");
  assert.equal(verified.tools.some((entry) => entry.name === "intercom" && entry.active), false);
  assert.equal(verified.tools.some((entry) => entry.owner === "only-my-pi" && entry.active), false);

  const forged = structuredClone(evidence);
  forged.commands.push(structuredClone(forged.commands[0]));
  assert.throws(
    () => assertM9StackProbeEvidence(forged),
    (error) => error.code === "M9_STACK_DUPLICATE_REGISTRATION",
  );
});
