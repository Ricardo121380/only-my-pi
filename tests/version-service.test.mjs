import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { saveSettings } from "../packages/config-runtime/index.mjs";
import { VersionService } from "../packages/control-service/version-service.mjs";
import { createStackLayout, finalizeStackState } from "../packages/release-stack/index.mjs";

async function fixture(t, { cliGeneration = `sha256:${"a".repeat(64)}` } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-version-service-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const configRoot = path.join(root, "agent");
  const piRoot = path.join(root, "lib", "node_modules", "@earendil-works", "pi-coding-agent");
  const binRoot = path.join(root, "bin");
  await fs.mkdir(path.join(source, "contracts", "compatibility"), { recursive: true });
  await fs.mkdir(path.join(piRoot, "dist"), { recursive: true });
  await fs.mkdir(binRoot, { recursive: true });
  await fs.writeFile(path.join(source, "package.json"), `${JSON.stringify({ name: "only-my-pi", version: "0.1.0" })}\n`);
  await fs.writeFile(path.join(source, "contracts", "compatibility", "upstream-candidates.json"), `${JSON.stringify({ decision: { state: "HOLD" } })}\n`);
  await fs.writeFile(path.join(piRoot, "package.json"), `${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3" })}\n`);
  await fs.writeFile(path.join(piRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
  await fs.symlink(path.join(piRoot, "dist", "cli.js"), path.join(binRoot, "pi"));
  const installedGenerationId = `sha256:${"a".repeat(64)}`;
  await saveSettings(configRoot, {
    onlyMyPi: {
      formatVersion: 1,
      profileId: "minimal",
      generationId: installedGenerationId,
      graphDigest: installedGenerationId,
      providerSelection: null,
      initialMode: null,
      managedSettings: { packages: [], extensions: [], skills: [], prompts: [], themes: [] },
    },
  });
  const userCli = {
    async inspectActive() {
      return {
        manifest: {
          artifactSha256: `sha256:${"b".repeat(64)}`,
          sourceCommit: "c".repeat(40),
          installedGenerationId: cliGeneration,
        },
      };
    },
  };
  return { root, source, configRoot, binRoot, installedGenerationId, userCli };
}

test("version reports CLI, generation, Pi and decision identities without a subprocess", async (t) => {
  const value = await fixture(t);
  const result = await new VersionService({
    rootDir: value.source,
    configRoot: value.configRoot,
    userCli: value.userCli,
    env: { PATH: value.binRoot },
  }).inspect();
  assert.equal(result.ok, true);
  assert.equal(result.packageVersion, "0.1.0");
  assert.equal(result.piVersion, "0.84.3");
  assert.equal(result.decision, "HOLD");
  assert.equal(result.cliRoot, "USER_LOCAL_IMMUTABLE_ARTIFACT");
  assert.equal(result.installedGenerationId, value.installedGenerationId);
  assert.equal(result.sourceCommit, "c".repeat(40));
});

test("version fails identity consistency when CLI and installed generation differ", async (t) => {
  const value = await fixture(t, { cliGeneration: `sha256:${"d".repeat(64)}` });
  const result = await new VersionService({ rootDir: value.source, configRoot: value.configRoot, userCli: value.userCli, env: { PATH: value.binRoot } }).inspect();
  assert.equal(result.ok, false);
  assert.equal(result.status, "CLI_GENERATION_IDENTITY_DRIFT");
});

test("version prefers one controlled Preview stack identity over the legacy CLI pointer", async (t) => {
  const value = await fixture(t);
  const stackLayout = createStackLayout({ homeDir: value.root, configRoot: value.configRoot });
  const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), "contracts", "release", "stack-manifest.example.json"), "utf8"));
  const stateInput = JSON.parse(await fs.readFile(path.join(process.cwd(), "contracts", "release", "stack-state.example.json"), "utf8"));
  stateInput.generation.digest = value.installedGenerationId;
  stateInput.cliArtifact.digest = manifest.onlyMyPi.artifactSha256;
  stateInput.onlyMyPi.digest = manifest.onlyMyPi.artifactSha256;
  delete stateInput.stateDigest;
  const state = finalizeStackState(stateInput);
  const active = path.join(stackLayout.stacksRoot, state.activeStack.slice("sha256:".length));
  await fs.mkdir(active, { recursive: true });
  await fs.writeFile(path.join(active, "stack-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(stackLayout.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const result = await new VersionService({
    rootDir: value.source,
    configRoot: value.configRoot,
    userCli: value.userCli,
    stackLayout,
    env: { PATH: value.binRoot },
  }).inspect();
  assert.equal(result.ok, true);
  assert.equal(result.packageVersion, "0.2.0-preview.1");
  assert.equal(result.releaseChannel, "preview");
  assert.equal(result.decision, "INTERNAL_DISTRIBUTION_FOUNDATION");
  assert.equal(result.currentReleaseAuthority, false);
  assert.equal(result.embeddedNodeVersion, "24.19.0");
  assert.equal(result.piVersion, "0.84.3");
  assert.equal(result.subagentsVersion, "0.57.0");
  assert.equal(result.stackId, manifest.stackId);
  assert.equal(result.cliRoot, "USER_LOCAL_CONTROLLED_STACK");
});
