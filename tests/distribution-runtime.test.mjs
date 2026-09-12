import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDistributionManifest } from "../packages/distribution/manifest-builder.mjs";
import { loadDistribution, resolveDistributionPackage, manifestDigest, PACKAGE_IDS } from "../packages/distribution/runtime.mjs";
import { PUBLIC_STACK_PACKAGES } from "../packages/release-stack/contracts.mjs";
import { resolveDirectExtensionSet } from "../packages/direct-agent/launcher.mjs";
import { handleDistributionCommand } from "../packages/distribution/commands.mjs";
import { runOmpEntrypoint } from "../bin/omp.mjs";

const AGENT_EXTENSIONS = ["extensions/sessions/index.ts", "extensions/context/index.ts", "extensions/review/index.ts", "extensions/notify/index.ts"];
const ENTRIES = { "permission-modes": ["src/index.ts"], subagents: ["index.ts"],
  "agent-extensions": AGENT_EXTENSIONS, lsp: ["dist/index.ts"], usage: ["dist/index.js"] };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-dist-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (relative, value) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  const packageRoot = path.join(root, "only-my-pi/package");
  await write("only-my-pi/package/package.json", { name: "only-my-pi", version: "0.4.0-preview.1" });
  await write("only-my-pi/package/bin/omp.mjs", "// fixture\n");
  for (const extension of ["session-ledger", "context-doctor", "omp-control", "omp-direct"])
    await write(`only-my-pi/package/extensions/${extension}/index.ts`, "export default function extension() {}\n");
  await write("pi/package.json", { name: "@earendil-works/pi-coding-agent", version: "0.84.3" });
  await write("pi/dist/bundle/cli.js", "// fixture Pi\n");
  for (const binary of ["fd", "rg"]) {
    await write(`pi/vendor-tools/bin/${binary}`, "#!/bin/sh\nexit 0\n");
    await fs.chmod(path.join(root, `pi/vendor-tools/bin/${binary}`), 0o755);
  }
  const packageFilters = {};
  for (const [id, name] of Object.entries(PACKAGE_IDS)) {
    const { version } = PUBLIC_STACK_PACKAGES.find((entry) => entry.name === name);
    await write(`external-npm/node_modules/${name}/package.json`, { name, version, pi: { extensions: (ENTRIES[id] ?? []).map((entry) => `./${entry}`) } });
    for (const entry of ENTRIES[id] ?? []) await write(`external-npm/node_modules/${name}/${entry}`, "export default function extension() {}\n");
    packageFilters[id] = id === "agent-extensions" ? AGENT_EXTENSIONS : [];
  }
  const manifest = await createDistributionManifest({ root, version: "0.4.0-preview.1", sourceCommit: "a".repeat(40),
    platform: { os: "darwin", arch: "arm64", minimumMacOS: "14.0" }, packageFilters });
  await write("distribution-manifest.json", manifest);
  const options = { packageRoot, platform: "darwin", arch: "arm64", kernelRelease: "23.0.0", nodeVersion: "24.19.0" };
  return { root, write, manifest, options, packageRoot };
}

test("native distribution resolves without an installed stack or Pi configuration", async (t) => {
  const f = await fixture(t);
  const runtime = await loadDistribution(f.options);
  assert.equal(runtime.distribution.version, "0.4.0-preview.1");
  assert.equal(runtime.nodePath, await fs.realpath(process.execPath));
  assert.equal(runtime.channel, "npm");
  const extensions = await resolveDirectExtensionSet({ stack: runtime, configRoot: path.join(f.root, "unused-home/.pi/agent") });
  assert.equal(extensions.extensions.length, 12);
  assert.ok(extensions.extensions.every((entry) => entry.startsWith(`${f.root}/`)));
  assert.equal(extensions.planModeOwner, "only-my-pi");
  await assert.rejects(fs.stat(path.join(f.root, "unused-home")), { code: "ENOENT" });
});

test("whole runtime and subsequent package drift fail before extension loading", async (t) => {
  const f = await fixture(t);
  const runtime = await loadDistribution(f.options);
  await f.write("external-npm/node_modules/pi-subagents/index.ts", "// modified\n");
  await assert.rejects(resolveDistributionPackage(runtime, "subagents"), { code: "RUNTIME_PACKAGE_DRIFT" });
  await assert.rejects(loadDistribution(f.options), { code: "DISTRIBUTION_CONTENT_DRIFT" });
});

test("a rehashed manifest cannot redirect component paths outside the payload", async (t) => {
  const f = await fixture(t);
  f.manifest.components.app.path = "../../outside";
  f.manifest.distributionId = manifestDigest(f.manifest);
  await f.write("distribution-manifest.json", f.manifest);
  await assert.rejects(loadDistribution(f.options), { code: "DISTRIBUTION_MANIFEST_INVALID" });
});

test("unsupported Node, macOS, OS and architecture have no legacy fallback", async (t) => {
  const f = await fixture(t);
  await assert.rejects(loadDistribution({ ...f.options, nodeVersion: "20.19.0" }), { code: "DISTRIBUTION_NODE_UNSUPPORTED" });
  for (const overrides of [{ kernelRelease: "22.0.0" }, { platform: "linux", glibc: "2.36" }, { arch: "x64" }]) {
    await assert.rejects(loadDistribution({ ...f.options, ...overrides }), { code: "DISTRIBUTION_PLATFORM_UNSUPPORTED" });
  }
});

test("manifest digest and audited dependency identities are mandatory", async (t) => {
  const f = await fixture(t);
  f.manifest.sourceCommit = "b".repeat(40);
  await f.write("distribution-manifest.json", f.manifest);
  await assert.rejects(loadDistribution(f.options), { code: "DISTRIBUTION_MANIFEST_INVALID" });
  f.manifest.packages[0].version = "99.0.0";
  f.manifest.distributionId = manifestDigest(f.manifest);
  await f.write("distribution-manifest.json", f.manifest);
  await assert.rejects(loadDistribution(f.options), { code: "DISTRIBUTION_MANIFEST_INVALID" });
});

test("a payload symlink cannot escape to an external dependency tree", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "external-npm/node_modules/pi-subagents/index.ts");
  await fs.unlink(target);
  await fs.symlink("/etc/hosts", target);
  await assert.rejects(loadDistribution(f.options));
});

test("packaged extension filters cannot expand the direct session surface", async (t) => {
  const f = await fixture(t);
  f.manifest.packages.find((entry) => entry.id === "agent-extensions").resourceFilter.push("extensions/unapproved.ts");
  f.manifest.distributionId = manifestDigest(f.manifest);
  await f.write("distribution-manifest.json", f.manifest);
  const runtime = await loadDistribution(f.options);
  await assert.rejects(resolveDirectExtensionSet({ stack: runtime, configRoot: path.join(f.root, "unused") }), { code: "OMP_DIRECT_RESOURCE_FILTER_DRIFT" });
});

test("public version reports OMP instead of forwarding to Pi", async (t) => {
  const f = await fixture(t);
  let output = "";
  const result = await runOmpEntrypoint({ argv: ["--version"], rootDir: f.packageRoot,
    stdout: { write: (chunk) => { output += chunk; } },
    agentLauncher: () => assert.fail("version must not launch Pi") });
  assert.equal(result, 0);
  assert.equal(output, "only-my-pi 0.4.0-preview.1\n");
});

test("native management reports its own version and refuses cross-manager mutations", async (t) => {
  const f = await fixture(t);
  const runtime = await loadDistribution(f.options);
  const homeDir = path.join(f.root, "unused-home");
  const version = await handleDistributionCommand({ runtime, argv: ["version", "--json"], homeDir, env: {} });
  assert.equal(version.result.packageVersion, "0.4.0-preview.1");
  assert.equal(version.result.installation.channel, "npm");
  for (const argv of [["install"], ["update", "--apply", "--yes"], ["uninstall", "--apply", "--yes"], ["stack", "remove", "--apply", "--yes"]]) {
    const result = await handleDistributionCommand({ runtime, argv, homeDir, env: {} });
    assert.equal(result.result.status, "PACKAGE_MANAGER_OWNS_INSTALLATION");
    assert.equal(result.result.mutation, false);
  }
  await assert.rejects(fs.stat(homeDir), { code: "ENOENT" });
});

test("raw Pi uses the packaged CLI and removes direct-product authority variables", async (t) => {
  const f = await fixture(t);
  const runtime = await loadDistribution(f.options);
  let invocation;
  await assert.rejects(handleDistributionCommand({ runtime, argv: ["pi", "--help"], homeDir: path.join(f.root, "home"),
    env: { PATH: "/usr/bin", ONLY_MY_PI_DIRECT: "1" },
    execve: (...args) => { invocation = args; throw new Error("REPLACED"); } }), /REPLACED/u);
  assert.deepEqual(invocation[1], [runtime.nodePath, runtime.piCliPath, "--help"]);
  assert.equal(invocation[2].ONLY_MY_PI_DIRECT, undefined);
  assert.equal(invocation[2].PI_CODING_AGENT_DIR, path.join(f.root, "home/.pi/agent"));
});
