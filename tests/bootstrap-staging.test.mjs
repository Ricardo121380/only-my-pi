import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  GENERATION_SCHEMA_ID,
  assertGenerationManifestShape,
  atomicPromoteGeneration,
  buildGenerationPlan,
  compileGenerationSettings,
  compileOwnedSettings,
  createGenerationLayout,
  planOwnedGraph,
  removeStagingGeneration,
  removeUnreferencedGeneration,
  stageAndPromoteGeneration,
  stageGeneration,
  verifyGenerationByManifest,
} from "../packages/bootstrap/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const maliciousFixture = path.join(repoRoot, "verification", "fixtures", "bootstrap", "staging", "malicious-lifecycle");
const tarballBytes = Buffer.from("deterministic fake tarball bytes\n", "utf8");
const tarballIntegrity = `sha512-${crypto.createHash("sha512").update(tarballBytes).digest("base64")}`;
const otherIntegrity = `sha512-${crypto.createHash("sha512").update("other bytes").digest("base64")}`;
const fullGitSha = "0123456789abcdef0123456789abcdef01234567";
const fixtureLifecycle = Object.freeze({
  execution: "disabled",
  scripts: [{
    name: "postinstall",
    commandSha256: "sha256:59d2cd09a8de3381d18089d2ab4f321d10936d00230427493de832048bb0a381",
    necessity: "not-required",
  }],
});
const generationSchema = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", "bootstrap-generation-v1.schema.json"), "utf8"));
const validateGenerationSchema = new Ajv2020({ allErrors: true, strict: true }).compile(generationSchema);

async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-bootstrap-staging-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function createArtifact(t) {
  const root = await temporaryDirectory(t);
  const artifactRoot = path.join(root, "artifact");
  await fs.mkdir(path.join(artifactRoot, "extensions", "local"), { recursive: true });
  await fs.mkdir(path.join(artifactRoot, "skills"), { recursive: true });
  await fs.writeFile(
    path.join(artifactRoot, "extensions", "local", "index.mjs"),
    "import { marker } from './helper.mjs'; export default () => marker;\n",
    "utf8",
  );
  await fs.writeFile(path.join(artifactRoot, "extensions", "local", "helper.mjs"), "export const marker = 'closure';\n", "utf8");
  await fs.writeFile(path.join(artifactRoot, "skills", "README.md"), "staged skill root\n", "utf8");
  return { root, artifactRoot, configRoot: path.join(root, "config") };
}

function packageEntry({
  id = "malicious-package",
  spec = "npm:omp-malicious-lifecycle@1.0.0",
  integrity = tarballIntegrity,
  resourceFilter = ["extensions/index.mjs"],
  lifecycle = fixtureLifecycle,
} = {}) {
  return {
    id,
    spec,
    scope: "global",
    installed: true,
    review: "fixture",
    owners: [id],
    risk: ["lifecycle-fixture"],
    notes: "scripts-disabled staging fixture",
    resourceFilter,
    audit: { date: "2026-08-16", integrity, lifecycle },
  };
}

function packageInventory(packages = [packageEntry()], candidates = []) {
  return {
    formatVersion: 1,
    runtime: { pi: "0.84.1", node: "25.8.0", platform: "darwin-arm64" },
    packages,
    candidates,
  };
}

function resourceInventory(resources = [
  {
    id: "local-extension",
    type: "extension",
    path: "extensions/local",
    version: "1.0.0",
    owners: ["local-extension"],
    defaultLoaded: true,
    profileEligibility: ["coding"],
    lifecycle: "stable",
    packaged: true,
  },
  {
    id: "skills-root",
    type: "skill",
    path: "skills",
    version: "1.0.0",
    owners: ["skills-root"],
    defaultLoaded: false,
    profileEligibility: ["coding"],
    lifecycle: "planned",
    packaged: true,
  },
]) {
  return { formatVersion: 1, resources };
}

function profile(packageIds = ["malicious-package"]) {
  return {
    formatVersion: 1,
    id: "coding",
    packageIds,
    capabilityIds: [],
    policy: { projectTrust: "ask", approval: "ask", network: "deny" },
  };
}

function createFakeRunner({
  requests,
  reportIntegrity = true,
  install = true,
  escapingSymlinkTarget,
  installedScripts,
  installedPeerDependencies,
  installForbiddenHost = false,
} = {}) {
  return async (request) => {
    requests?.push(request);
    assert.equal(request.command, "npm");
    assert.equal(request.shell, false);
    assert.equal(request.envOverlay.npm_config_ignore_scripts, "true");
    assert.ok(Array.isArray(request.argv));
    assert.ok(request.argv.includes("--ignore-scripts"));
    if (request.argv[0] === "pack") {
      const destination = request.argv[request.argv.indexOf("--pack-destination") + 1];
      const filename = "omp-malicious-lifecycle-1.0.0.tgz";
      await fs.writeFile(path.join(destination, filename), tarballBytes);
      return {
        exitCode: 0,
        stdout: JSON.stringify([{
          id: "omp-malicious-lifecycle@1.0.0",
          name: "omp-malicious-lifecycle",
          version: "1.0.0",
          filename,
          ...(reportIntegrity ? { integrity: tarballIntegrity } : {}),
        }]),
        stderr: "",
      };
    }
    assert.equal(request.argv[0], "install");
    if (install) {
      const prefix = request.argv[request.argv.indexOf("--prefix") + 1];
      const target = path.join(prefix, "node_modules", "omp-malicious-lifecycle");
      await fs.cp(maliciousFixture, target, { recursive: true, errorOnExist: true, force: false });
      if (installedScripts !== undefined || installedPeerDependencies !== undefined) {
        const packageJsonPath = path.join(target, "package.json");
        const packageManifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        if (installedScripts !== undefined) packageManifest.scripts = installedScripts;
        if (installedPeerDependencies !== undefined) packageManifest.peerDependencies = installedPeerDependencies;
        await fs.writeFile(packageJsonPath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
      }
      const binRoot = path.join(prefix, "node_modules", ".bin");
      await fs.mkdir(binRoot, { recursive: true });
      await fs.symlink("../omp-malicious-lifecycle/lifecycle.mjs", path.join(binRoot, "fixture-lifecycle"));
      if (escapingSymlinkTarget) await fs.symlink(escapingSymlinkTarget, path.join(binRoot, "escape"));
      if (installForbiddenHost) {
        const hostRoot = path.join(prefix, "node_modules", "@earendil-works", "pi-coding-agent");
        await fs.mkdir(hostRoot, { recursive: true });
        await fs.writeFile(path.join(hostRoot, "package.json"), '{"name":"@earendil-works/pi-coding-agent","version":"0.84.1"}\n', "utf8");
      }
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

test("owned graph planning is deterministic and binds exact package and resource content", async (t) => {
  const { artifactRoot } = await createArtifact(t);
  const second = packageEntry({ id: "second-package", spec: "npm:second-package@2.0.0", resourceFilter: [] });
  const firstInventory = packageInventory([second, packageEntry()]);
  const secondInventory = packageInventory([packageEntry(), second]);
  const resources = resourceInventory().resources;
  const left = await planOwnedGraph({
    packageInventory: firstInventory,
    resourceInventory: resourceInventory(resources),
    profile: profile(["second-package", "malicious-package"]),
    artifactRoot,
  });
  const right = await planOwnedGraph({
    packageInventory: secondInventory,
    resourceInventory: resourceInventory([...resources].reverse()),
    profile: profile(["malicious-package", "second-package"]),
    artifactRoot,
  });
  assert.equal(left.graphDigest, right.graphDigest);
  assert.deepEqual(left.packages.map((entry) => entry.id), ["malicious-package", "second-package"]);
  assert.deepEqual(left.resources.map((entry) => entry.id), ["local-extension", "skills-root"]);
  assert.match(left.graphDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(left.resources[0].sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    planOwnedGraph({
      packageInventory: packageInventory([packageEntry(), packageEntry({ id: "duplicate-source" })]),
      resourceInventory: resourceInventory([]),
      profile: profile(["malicious-package", "duplicate-source"]),
      artifactRoot,
    }),
    (error) => error.code === "PACKAGE_SOURCE_COLLISION",
  );
});

test("owned graph planning rejects candidates, unpinned sources, missing SRI, and resource symlinks", async (t) => {
  const { artifactRoot } = await createArtifact(t);
  const candidate = { ...packageEntry({ id: "candidate" }), installed: undefined, mode: "trial" };
  await assert.rejects(
    planOwnedGraph({ packageInventory: packageInventory([], [candidate]), resourceInventory: resourceInventory([]), profile: profile(["candidate"]), artifactRoot }),
    (error) => error.code === "CANDIDATE_NOT_PROMOTED",
  );
  await assert.rejects(
    planOwnedGraph({ packageInventory: packageInventory([packageEntry({ spec: "npm:omp-malicious-lifecycle@^1.0.0" })]), resourceInventory: resourceInventory([]), profile: profile(), artifactRoot }),
    TypeError,
  );
  await assert.rejects(
    planOwnedGraph({ packageInventory: packageInventory([packageEntry({ spec: "git+https://github.com/example/package.git#main" })]), resourceInventory: resourceInventory([]), profile: profile(), artifactRoot }),
    TypeError,
  );
  await assert.rejects(
    planOwnedGraph({ packageInventory: packageInventory([packageEntry({ lifecycle: null })]), resourceInventory: resourceInventory([]), profile: profile(), artifactRoot }),
    (error) => error.code === "PACKAGE_LIFECYCLE_AUDIT_REQUIRED",
  );
  await assert.rejects(
    planOwnedGraph({
      packageInventory: packageInventory([packageEntry({
        lifecycle: {
          execution: "disabled",
          scripts: fixtureLifecycle.scripts.map((script) => ({ ...script, necessity: "required" })),
        },
      })]),
      resourceInventory: resourceInventory([]),
      profile: profile(),
      artifactRoot,
    }),
    (error) => error.code === "PACKAGE_LIFECYCLE_SANDBOX_REQUIRED",
  );
  const exactGit = await planOwnedGraph({
    packageInventory: packageInventory([packageEntry({ spec: `git+https://github.com/example/package.git#${fullGitSha}` })]),
    resourceInventory: resourceInventory([]),
    profile: profile(),
    artifactRoot,
  });
  assert.deepEqual(exactGit.packages[0].source, {
    type: "git",
    protocol: "git+https",
    repository: "git+https://github.com/example/package.git",
    commit: fullGitSha,
  });
  const gitWithoutIntegrity = packageEntry({ spec: `git+https://github.com/example/package.git#${fullGitSha}` });
  delete gitWithoutIntegrity.audit.integrity;
  await assert.rejects(
    planOwnedGraph({
      packageInventory: packageInventory([gitWithoutIntegrity]),
      resourceInventory: resourceInventory([]),
      profile: profile(),
      artifactRoot,
    }),
    (error) => error.code === "PACKAGE_AUDIT_REQUIRED",
  );
  const symlinkPath = path.join(artifactRoot, "extensions", "symlink.mjs");
  await fs.symlink(path.join(artifactRoot, "extensions", "local", "index.mjs"), symlinkPath);
  const symlinkResource = {
    ...resourceInventory().resources[0],
    id: "symlink-extension",
    path: "extensions/symlink.mjs",
  };
  await assert.rejects(
    planOwnedGraph({ packageInventory: packageInventory([]), resourceInventory: resourceInventory([symlinkResource]), profile: profile([]), artifactRoot }),
    (error) => error.code === "RESOURCE_SYMLINK",
  );
});

test("scripts-disabled staging verifies tarballs/resources before atomic promotion and compiles relative settings", async (t) => {
  const { root, artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({
    packageInventory: packageInventory(),
    resourceInventory: resourceInventory(),
    profile: profile(),
    artifactRoot,
  });
  const requests = [];
  let promotionCalled = false;
  const result = await stageAndPromoteGeneration({
    plan,
    configRoot,
    transactionId: "txn-one",
    artifactRoot,
    runCommand: createFakeRunner({ requests }),
    promote: async (promotion) => {
      promotionCalled = true;
      assert.equal(promotion.graphDigest, plan.graphDigest);
      await fs.access(path.join(promotion.stagingRoot, ".only-my-pi-generation.json"));
      await atomicPromoteGeneration(promotion);
    },
  });
  assert.equal(promotionCalled, true);
  assert.equal(result.receipt.status, "VERIFIED_PROMOTED");
  assert.equal(result.manifest.$schema, GENERATION_SCHEMA_ID);
  assert.equal(validateGenerationSchema(result.manifest), true, JSON.stringify(validateGenerationSchema.errors));
  assert.equal(assertGenerationManifestShape(result.manifest), result.manifest);
  assert.equal(result.receipt.created, true);
  assert.equal(result.manifest.packages[0].lifecycleExecution, "DISABLED");
  assert.deepEqual(result.manifest.packages[0].lifecycleScripts, ["postinstall"]);
  assert.equal(await fs.stat(result.layout.generationRoot).then(() => true), true);
  assert.equal(
    await fs.readFile(path.join(result.layout.generationRoot, "resources", "extensions", "local", "helper.mjs"), "utf8"),
    "export const marker = 'closure';\n",
  );
  await assert.rejects(fs.access(result.layout.stagingRoot));

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.shell, false);
    assert.equal(request.argv.includes("--ignore-scripts"), true);
    assert.equal(request.envOverlay.npm_config_ignore_scripts, "true");
  }
  assert.equal(requests[0].argv.includes("--"), true);
  assert.equal(requests[1].argv.includes("--"), true);
  assert.equal(requests[1].argv.includes("--no-save"), true);
  assert.equal(requests[1].argv.includes("--omit=peer"), true);
  assert.equal(requests[1].argv.includes("--legacy-peer-deps"), true);
  const externalMarker = path.join(root, "host-lifecycle-marker");
  await assert.rejects(fs.access(externalMarker));
  await assert.rejects(fs.access(path.join(
    result.layout.generationRoot,
    "npm",
    "node_modules",
    "omp-malicious-lifecycle",
    "LIFECYCLE_RAN",
  )));

  const compiled = await compileGenerationSettings({
    plan,
    promotion: result.receipt,
    configRoot,
  });
  assert.equal(compiled.status, "VERIFIED");
  assert.match(compiled.generationRelativeRoot, /^\.\/only-my-pi\/generations\/[a-f0-9]{64}$/);
  assert.deepEqual(compiled.ownedSettings.packages, [{
    source: `${compiled.generationRelativeRoot}/npm/node_modules/omp-malicious-lifecycle`,
    extensions: ["extensions/index.mjs"],
    skills: [],
    prompts: [],
    themes: [],
  }]);
  assert.deepEqual(compiled.ownedSettings.extensions, [
    `${compiled.generationRelativeRoot}/resources/extensions/local`,
  ]);
  assert.deepEqual(compiled.ownedSettings.skills, []);
  assert.equal(JSON.stringify(compiled).includes(configRoot), false);
});

test("promoted minimal generation closes the /omp mode runtime import graph", async (t) => {
  const configRoot = await temporaryDirectory(t);
  const plan = await buildGenerationPlan({ rootDir: repoRoot, profileId: "minimal" });
  const generation = await stageAndPromoteGeneration({
    plan,
    configRoot,
    transactionId: "m3-runtime-closure",
    artifactRoot: repoRoot,
    runCommand: createFakeRunner({ requests: [] }),
  });
  const root = generation.layout.generationRoot;
  for (const relative of [
    "resources/extensions/omp-control/runtime.mjs",
    "resources/extensions/context-doctor/metrics.mjs",
    "resources/packages/control-service/mode-service.mjs",
    "resources/packages/control-service/workflow-service.mjs",
    "resources/packages/mode-registry/index.mjs",
    "resources/schemas/mode-v1.schema.json",
    "resources/modes/inspect.json",
    "resources/modes/prompts/inspect.md",
    "resources/policies/capabilities.v1.json",
    "resources/inventory/packages.lock.json",
    "resources/profiles/minimal.json",
  ]) {
    await fs.access(path.join(root, relative));
  }

  const runtimeModule = await import(`${pathToFileURL(path.join(root, "resources/extensions/omp-control/runtime.mjs"))}?m3=${Date.now()}`);
  const runtime = runtimeModule.createOmpRuntime();
  const listed = await runtime.execute("mode list");
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.ok(listed.modes.some((mode) => mode.id === "inspect"), JSON.stringify(listed));
  const shown = await runtime.execute("mode show inspect");
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.equal(shown.mode.modeId, "inspect");
  assert.equal(typeof shown.mode.promptPayloads?.[0]?.content, "string");
  const workflows = await runtime.execute("workflow list");
  assert.equal(workflows.ok, true, JSON.stringify(workflows));
  assert.equal(workflows.status, "WORKFLOW_LIST");
  // The minimal profile intentionally stages only the read-only fallback;
  // richer Workflow resources are eligible for coding/research profiles and
  // are covered by the source-level registry suite.
  assert.ok(workflows.workflows.some((workflow) => workflow.id === "single-agent-safe"), JSON.stringify(workflows));
  const workflowPlan = await runtime.execute("workflow run single-agent-safe");
  assert.equal(workflowPlan.ok, false, JSON.stringify(workflowPlan));
  assert.equal(workflowPlan.status, "WORKFLOW_PLAN_UNAVAILABLE");
  assert.equal(workflowPlan.code, "WORKFLOW_V2_RUNTIME_UNAVAILABLE");
});

test("promoted orchestration resources close the Workflow v2 and Swarm planning import graph", async (t) => {
  const configRoot = await temporaryDirectory(t);
  const packageDocument = JSON.parse(await fs.readFile(path.join(repoRoot, "inventory", "packages.lock.json"), "utf8"));
  const resourceDocument = JSON.parse(await fs.readFile(path.join(repoRoot, "inventory", "resources.lock.json"), "utf8"));
  const plan = await planOwnedGraph({
    packageInventory: { ...packageDocument, packages: [], candidates: [] },
    resourceInventory: resourceDocument,
    profile: { formatVersion: 1, id: "orchestration", packageIds: [] },
    artifactRoot: repoRoot,
  });
  const generation = await stageAndPromoteGeneration({
    plan,
    configRoot,
    transactionId: "s2-orchestration-closure",
    artifactRoot: repoRoot,
    runCommand: async () => { throw new Error("resource-only closure must not invoke npm"); },
  });
  const root = generation.layout.generationRoot;
  const compiled = await compileGenerationSettings({
    plan,
    promotion: generation.receipt,
    configRoot,
    transactionId: "s2-orchestration-settings",
  });
  assert.equal(compiled.ownedSettings.packages.length, 1);
  assert.match(compiled.ownedSettings.packages[0], /resources\/bundles\/only-my-pi-agent-bundle$/u);
  for (const relative of [
    "resources/bundles/only-my-pi-agent-bundle/package.json",
    "resources/bundles/only-my-pi-agent-bundle/agents/omp-reviewer.md",
    "resources/extensions/omp-control/runtime.mjs",
    "resources/packages/control-service/workflow-service.mjs",
    "resources/packages/control-service/swarm-service.mjs",
    "resources/packages/subagents/workflow/migration/index.mjs",
    "resources/packages/subagents/workflow/plan-compiler/index.mjs",
    "resources/packages/swarm-core/index.mjs",
    "resources/swarm/recipes/research-synthesis.json",
  ]) await fs.access(path.join(root, relative));

  const runtimeModule = await import(`${pathToFileURL(path.join(root, "resources/extensions/omp-control/runtime.mjs"))}?s2=${Date.now()}`);
  const runtime = runtimeModule.createOmpRuntime();
  const workflowPlan = await runtime.execute("workflow run single-agent-safe");
  assert.equal(workflowPlan.status, "WORKFLOW_PLAN", JSON.stringify(workflowPlan));
  assert.match(workflowPlan.plan.planDigest, /^sha256:[a-f0-9]{64}$/u);
  const swarmPlan = await runtime.execute("swarm plan research-synthesis");
  assert.equal(swarmPlan.status, "SWARM_PLAN", JSON.stringify(swarmPlan));
  assert.match(swarmPlan.plan.planDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("promoted daily generation closes the direct Agent runtime import graph", async (t) => {
  const configRoot = await temporaryDirectory(t);
  const packageDocument = JSON.parse(await fs.readFile(path.join(repoRoot, "inventory", "packages.lock.json"), "utf8"));
  const resourceDocument = JSON.parse(await fs.readFile(path.join(repoRoot, "inventory", "resources.lock.json"), "utf8"));
  const plan = await planOwnedGraph({
    packageInventory: { ...packageDocument, packages: [], candidates: [] },
    resourceInventory: resourceDocument,
    profile: { formatVersion: 1, id: "daily", packageIds: [] },
    artifactRoot: repoRoot,
  });
  const generation = await stageAndPromoteGeneration({
    plan,
    configRoot,
    transactionId: "m12-direct-runtime-closure",
    artifactRoot: repoRoot,
    runCommand: async () => { throw new Error("resource-only closure must not invoke npm"); },
  });
  const root = generation.layout.generationRoot;
  for (const relative of [
    "resources/extensions/omp-direct/index.ts",
    "resources/extensions/omp-direct/runtime.mjs",
    "resources/packages/direct-agent/managed-clone.mjs",
    "resources/packages/direct-agent/orchestration.mjs",
    "resources/packages/direct-agent/workspace.mjs",
    "resources/packages/daily-config/index.mjs",
  ]) await fs.access(path.join(root, relative));

  const runtimeModule = await import(`${pathToFileURL(path.join(root, "resources/extensions/omp-direct/runtime.mjs"))}?m12=${Date.now()}`);
  assert.equal(typeof runtimeModule.createDirectSessionController, "function");
  assert.ok(runtimeModule.DIRECT_READ_ONLY_AGENTS.includes("omp-reviewer"));
});

test("integrity mismatch fails before install and before generation promotion", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({
    packageInventory: packageInventory([packageEntry({ integrity: otherIntegrity })]),
    resourceInventory: resourceInventory([]),
    profile: profile(),
    artifactRoot,
  });
  const requests = [];
  await assert.rejects(
    stageAndPromoteGeneration({
      plan,
      configRoot,
      transactionId: "integrity-failure",
      artifactRoot,
      runCommand: createFakeRunner({ requests, reportIntegrity: false }),
    }),
    (error) => error.code === "TARBALL_INTEGRITY_MISMATCH",
  );
  assert.equal(requests.length, 1);
  const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId: "integrity-failure" });
  await assert.rejects(fs.access(layout.generationRoot));
  await fs.access(layout.stagingRoot);
  assert.equal(await removeStagingGeneration({ layout }), true);
  await assert.rejects(fs.access(layout.stagingRoot));
  assert.equal(await removeStagingGeneration({ layout }), false);
});

test("lifecycle audit rejects command digest drift and undeclared scripts before promotion", async (t) => {
  for (const [transactionId, installedScripts] of [
    ["lifecycle-digest-drift", { postinstall: "node changed-lifecycle.mjs" }],
    ["lifecycle-undeclared", { postinstall: "node lifecycle.mjs", prepare: "node lifecycle.mjs" }],
  ]) {
    const { artifactRoot, configRoot } = await createArtifact(t);
    const plan = await planOwnedGraph({
      packageInventory: packageInventory(),
      resourceInventory: resourceInventory([]),
      profile: profile(),
      artifactRoot,
    });
    await assert.rejects(
      stageGeneration(plan, {
        configRoot,
        transactionId,
        artifactRoot,
        runner: createFakeRunner({ installedScripts }),
      }),
      (error) => error.code === "PACKAGE_LIFECYCLE_AUDIT_MISMATCH",
    );
    const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId });
    await assert.rejects(fs.access(layout.generationRoot));
    await fs.access(layout.stagingRoot);
    await removeStagingGeneration({ layout });
  }
});

test("realized package trees may not contain a second Pi host", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({
    packageInventory: packageInventory(),
    resourceInventory: resourceInventory([]),
    profile: profile(),
    artifactRoot,
  });
  await assert.rejects(
    stageGeneration(plan, {
      configRoot,
      transactionId: "duplicate-pi-host",
      artifactRoot,
      runner: createFakeRunner({ installForbiddenHost: true }),
    }),
    (error) => error.code === "BUNDLED_PI_HOST_FORBIDDEN",
  );
});

test("direct package Pi host peers must use the current scope and accept the governed runtime", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({
    packageInventory: packageInventory(),
    resourceInventory: resourceInventory([]),
    profile: profile(),
    artifactRoot,
  });
  await assert.rejects(
    stageAndPromoteGeneration({
      plan,
      configRoot,
      transactionId: "legacy-peer",
      artifactRoot,
      runCommand: createFakeRunner({
        installedPeerDependencies: { "@mariozechner/pi-coding-agent": "*" },
      }),
    }),
    (error) => error.code === "LEGACY_PI_HOST_PEER_FORBIDDEN",
  );
  await assert.rejects(
    stageAndPromoteGeneration({
      plan,
      configRoot,
      transactionId: "incompatible-peer",
      artifactRoot,
      runCommand: createFakeRunner({
        installedPeerDependencies: { "@earendil-works/pi-coding-agent": "<0.80.0" },
      }),
    }),
    (error) => error.code === "PACKAGE_PI_PEER_INCOMPATIBLE",
  );
  const accepted = await stageAndPromoteGeneration({
    plan,
    configRoot,
    transactionId: "compatible-peer",
    artifactRoot,
    runCommand: createFakeRunner({
      installedPeerDependencies: { "@earendil-works/pi-coding-agent": ">=0.80.0" },
    }),
  });
  assert.equal(accepted.receipt.status, "VERIFIED_PROMOTED");
});

test("resource source drift fails closed before generation promotion", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({
    packageInventory: packageInventory([]),
    resourceInventory: resourceInventory(),
    profile: profile([]),
    artifactRoot,
  });
  await fs.writeFile(path.join(artifactRoot, "extensions", "local", "index.mjs"), "export default () => 'drift';\n", "utf8");
  await assert.rejects(
    stageAndPromoteGeneration({
      plan,
      configRoot,
      transactionId: "resource-drift",
      artifactRoot,
      runCommand: async () => assert.fail("npm must not run for an empty package graph"),
    }),
    (error) => error.code === "RESOURCE_SOURCE_DRIFT",
  );
  const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId: "resource-drift" });
  await assert.rejects(fs.access(layout.generationRoot));
});

test("generation staging rejects a symlinked managed root", async (t) => {
  const { root, artifactRoot, configRoot } = await createArtifact(t);
  const outside = path.join(root, "outside-managed-root");
  await fs.mkdir(configRoot, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.symlink(outside, path.join(configRoot, "only-my-pi"));
  const plan = await planOwnedGraph({ packageInventory: packageInventory([]), resourceInventory: resourceInventory([]), profile: profile([]), artifactRoot });
  await assert.rejects(
    stageGeneration(plan, {
      configRoot,
      transactionId: "symlinked-root",
      artifactRoot,
      runner: async () => assert.fail("npm must not run through a symlinked managed root"),
    }),
    (error) => error.code === "UNSAFE_MANAGED_PATH",
  );
});

test("npm tree verification permits contained bin links but rejects a symlink escape", async (t) => {
  const { root, artifactRoot, configRoot } = await createArtifact(t);
  const outside = path.join(root, "outside-target");
  await fs.writeFile(outside, "outside\n", "utf8");
  const plan = await planOwnedGraph({ packageInventory: packageInventory(), resourceInventory: resourceInventory([]), profile: profile(), artifactRoot });
  await assert.rejects(
    stageGeneration(plan, {
      configRoot,
      transactionId: "symlink-escape",
      artifactRoot,
      runner: createFakeRunner({ escapingSymlinkTarget: outside }),
    }),
    (error) => error.code === "UNSAFE_TREE_SYMLINK",
  );
  const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId: "symlink-escape" });
  await assert.rejects(fs.access(layout.generationRoot));
  await fs.access(layout.stagingRoot);
  await removeStagingGeneration({ layout });
});

test("promotion seam must move rather than copy the verified staging generation", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({ packageInventory: packageInventory([]), resourceInventory: resourceInventory([]), profile: profile([]), artifactRoot });
  const transactionId = "weak-promotion";
  await assert.rejects(
    stageGeneration(plan, {
      configRoot,
      transactionId,
      artifactRoot,
      runner: async () => assert.fail("npm must not run for an empty package graph"),
      promote: async ({ stagingRoot, generationRoot }) => fs.cp(stagingRoot, generationRoot, { recursive: true }),
    }),
    (error) => error.code === "PROMOTION_NOT_ATOMIC",
  );
  const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId });
  await fs.access(layout.stagingRoot);
  await fs.access(layout.generationRoot);
  await removeStagingGeneration({ layout });
  await removeUnreferencedGeneration({ layout });
});

test("existing verified generation is idempotently reused without invoking the command runner", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({ packageInventory: packageInventory(), resourceInventory: resourceInventory(), profile: profile(), artifactRoot });
  const first = await stageGeneration(plan, {
    configRoot,
    transactionId: "first-apply",
    artifactRoot,
    runner: createFakeRunner(),
  });
  const second = await stageGeneration(plan, {
    configRoot,
    transactionId: "second-apply",
    artifactRoot,
    runner: async () => assert.fail("idempotent reuse must not invoke npm"),
  });
  assert.equal(first.receipt.created, true);
  assert.equal(second.receipt.created, false);
  assert.equal(second.receipt.reused, true);
  assert.equal(second.receipt.manifestDigest, first.receipt.manifestDigest);
  const compiled = await compileOwnedSettings(plan, second, { configRoot });
  assert.equal(compiled.graphDigest, plan.graphDigest);
});

test("settings compilation rejects an unverified receipt and generation content drift", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({ packageInventory: packageInventory(), resourceInventory: resourceInventory(), profile: profile(), artifactRoot });
  const generation = await stageGeneration(plan, {
    configRoot,
    transactionId: "tamper-check",
    artifactRoot,
    runner: createFakeRunner(),
  });
  await assert.rejects(
    compileGenerationSettings({ plan, promotion: { ...generation.receipt, status: "STAGED" }, configRoot }),
    (error) => error.code === "UNVERIFIED_GENERATION",
  );
  const installedExtension = path.join(generation.layout.generationRoot, "npm", "node_modules", "omp-malicious-lifecycle", "extensions", "index.mjs");
  await fs.writeFile(installedExtension, "export default () => 'tampered';\n", "utf8");
  await assert.rejects(
    compileOwnedSettings(plan, generation, { configRoot }),
    (error) => error.code === "INSTALLED_PACKAGE_DRIFT",
  );
});

test("generation schema and runtime shape validator agree on structural negatives and runtime closes digest identity", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({ packageInventory: packageInventory(), resourceInventory: resourceInventory(), profile: profile(), artifactRoot });
  const generation = await stageGeneration(plan, {
    configRoot,
    transactionId: "shape-parity",
    artifactRoot,
    runner: createFakeRunner(),
  });

  const unknownField = structuredClone(generation.manifest);
  unknownField.unexpected = true;
  assert.equal(validateGenerationSchema(unknownField), false);
  assert.throws(() => assertGenerationManifestShape(unknownField), (error) => error.code === "GENERATION_MANIFEST_INVALID");

  const duplicatePackage = structuredClone(generation.manifest);
  duplicatePackage.packages.push(structuredClone(duplicatePackage.packages[0]));
  assert.equal(validateGenerationSchema(duplicatePackage), false);
  assert.throws(() => assertGenerationManifestShape(duplicatePackage), (error) => error.code === "GENERATION_MANIFEST_INVALID");

  const duplicatePackagePath = structuredClone(generation.manifest);
  duplicatePackagePath.packages.push({ ...structuredClone(duplicatePackagePath.packages[0]), id: "z-package" });
  assert.equal(validateGenerationSchema(duplicatePackagePath), true, JSON.stringify(validateGenerationSchema.errors));
  assert.throws(() => assertGenerationManifestShape(duplicatePackagePath), (error) => error.code === "GENERATION_MANIFEST_INVALID");

  const crossFieldMismatch = structuredClone(generation.manifest);
  crossFieldMismatch.generationKey = "b".repeat(64);
  assert.equal(validateGenerationSchema(crossFieldMismatch), true, JSON.stringify(validateGenerationSchema.errors));
  assert.throws(() => assertGenerationManifestShape(crossFieldMismatch), (error) => error.code === "GENERATION_MANIFEST_INVALID");
});

test("unreferenced generation cleanup requires the exact managed layout and verified manifest digest", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({ packageInventory: packageInventory(), resourceInventory: resourceInventory([]), profile: profile(), artifactRoot });
  const generation = await stageGeneration(plan, {
    configRoot,
    transactionId: "generation-cleanup",
    artifactRoot,
    runner: createFakeRunner(),
  });
  await assert.rejects(
    removeUnreferencedGeneration({ layout: generation.layout, expectedManifestDigest: `sha256:${"f".repeat(64)}` }),
    (error) => error.code === "GENERATION_CLEANUP_DIGEST_MISMATCH",
  );
  await fs.access(generation.layout.generationRoot);
  await assert.rejects(
    removeUnreferencedGeneration({
      layout: { ...generation.layout, generationRoot: configRoot },
      expectedManifestDigest: generation.receipt.manifestDigest,
    }),
    (error) => error.code === "UNSAFE_GENERATION_LAYOUT",
  );
  await fs.access(generation.layout.generationRoot);
  assert.equal(await removeUnreferencedGeneration({
    layout: generation.layout,
    expectedManifestDigest: generation.receipt.manifestDigest,
  }), true);
  await assert.rejects(fs.access(generation.layout.generationRoot));
  assert.equal(await removeUnreferencedGeneration({
    layout: generation.layout,
    expectedManifestDigest: generation.receipt.manifestDigest,
  }), false);
});

test("historical generation verification is manifest-driven and rejects tarball drift without a current plan", async (t) => {
  const { artifactRoot, configRoot } = await createArtifact(t);
  const plan = await planOwnedGraph({ packageInventory: packageInventory(), resourceInventory: resourceInventory(), profile: profile(), artifactRoot });
  const generation = await stageGeneration(plan, {
    configRoot,
    transactionId: "historical-verify",
    artifactRoot,
    runner: createFakeRunner(),
  });
  const historical = await verifyGenerationByManifest({
    layout: generation.layout,
    expectedManifestDigest: generation.receipt.manifestDigest,
  });
  assert.equal(historical.manifest.graphDigest, plan.graphDigest);
  assert.equal(historical.receipt.status, "VERIFIED_PROMOTED");
  await assert.rejects(
    verifyGenerationByManifest({
      layout: generation.layout,
      expectedManifestDigest: `sha256:${"0".repeat(64)}`,
    }),
    (error) => error.code === "GENERATION_MANIFEST_DIGEST_MISMATCH",
  );

  const tarballPath = path.join(
    generation.layout.generationRoot,
    ...generation.manifest.packages[0].tarballPath.split("/"),
  );
  await fs.appendFile(tarballPath, "tamper");
  await assert.rejects(
    verifyGenerationByManifest({ layout: generation.layout }),
    (error) => error.code === "TARBALL_INTEGRITY_MISMATCH",
  );
  await fs.writeFile(tarballPath, tarballBytes);
  assert.equal((await verifyGenerationByManifest({ layout: generation.layout })).manifest.manifestDigest, generation.receipt.manifestDigest);
});

test("repository convenience planner reads the canonical profile without network or writes", async () => {
  const sourceCommit = "a".repeat(40);
  const plan = await buildGenerationPlan({ rootDir: repoRoot, profileId: "minimal", sourceCommit });
  assert.equal(plan.profileId, "minimal");
  assert.equal(plan.sourceCommit, sourceCommit);
  assert.deepEqual(plan.packages, []);
  const resources = new Map(plan.resources.map((resource) => [resource.id, resource]));
  assert.equal(resources.get("session-ledger")?.path, "extensions/session-ledger/index.ts");
  assert.equal(resources.get("session-ledger-runtime")?.path, "extensions/session-ledger/ledger.mjs");
  assert.equal(resources.get("context-doctor")?.path, "extensions/context-doctor/index.ts");
  assert.equal(resources.get("context-doctor-runtime")?.path, "extensions/context-doctor/metrics.mjs");
  assert.equal(resources.get("session-ledger-runtime")?.defaultLoaded, false);
  assert.equal(resources.get("context-doctor-runtime")?.defaultLoaded, false);
});
