import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildGenerationPlan } from "../packages/bootstrap/index.mjs";
import { compileStackPackageSettings, createStackHarnessAdapter, hashFile } from "../packages/release-stack/index.mjs";

const INSTALLER = path.join(process.cwd(), "distribution", "install.sh");

test("verified installer is fixed-version, checksum-first, credential-free, and never pipe-to-shell", async () => {
  const source = await fs.readFile(INSTALLER, "utf8");
  await hashFile(INSTALLER);
  assert.match(source, /VERSION='0\.3\.0-preview\.1'/u);
  assert.match(source, /NODE_SHA256='8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d'/u);
  assert.match(source, /shasum -a 256/u);
  assert.match(source, /npm_config_ignore_scripts=true/u);
  assert.match(source, /npm_config_offline=true/u);
  assert.match(source, /env -i/u);
  assert.match(source, /stack install --bundle/u);
  assert.match(source, /--max-redirs 0/u);
  assert.match(source, /301\|302\|303\|307\|308/u);
  assert.match(source, /release-assets\.githubusercontent\.com/u);
  assert.match(source, /download redirect is missing or is not absolute HTTPS/u);
  assert.doesNotMatch(source, /curl[^\n]*\|[^\n]*(?:sh|bash)/u);
  assert.doesNotMatch(source, /curl[^\n]*--location/u);
  assert.doesNotMatch(source, /latest/u);
  assert.doesNotMatch(source, /Authorization|GITHUB_TOKEN|NPM_TOKEN|\.npmrc/u);
  for (const document of ["README.md", "docs/quickstart.md"]) {
    const text = await fs.readFile(path.join(process.cwd(), document), "utf8");
    assert.doesNotMatch(text, /releases\/download\/v0\.2\.0-preview\.1/u, `${document} must not advertise the withheld M11 release`);
    assert.doesNotMatch(text, /curl[^\n]*\|[ \t]*(?:\/bin\/)?(?:sh|bash)(?:[ \t]|$)/u);
  }
  const syntax = spawnSync("/bin/sh", ["-n", INSTALLER], { encoding: "utf8", shell: false });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("installer rejects unsupported arguments before any network or filesystem staging", () => {
  const result = spawnSync("/bin/sh", [INSTALLER, "--url", "https://example.invalid"], { encoding: "utf8", shell: false, env: { PATH: "/usr/bin:/bin", HOME: "/tmp" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported argument/u);
});

test("packaged only-my-pi artifact can install from an empty offline npm cache", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp("/tmp/omp-offline-artifact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root], { cwd: process.cwd(), encoding: "utf8", shell: false });
  assert.equal(packed.status, 0, packed.stderr);
  const artifact = path.join(root, packed.stdout.trim().split(/\r?\n/u).at(-1));
  const prefix = path.join(root, "prefix");
  const cache = path.join(root, "cache");
  const home = path.join(root, "home");
  await fs.mkdir(cache);
  await fs.mkdir(home);
  const installed = spawnSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps", "--package-lock=false", "--no-save", "--prefix", prefix, "--", artifact], {
    encoding: "utf8",
    shell: false,
    env: { PATH: process.env.PATH ?? "", HOME: home, npm_config_cache: cache, npm_config_ignore_scripts: "true", npm_config_offline: "true" },
  });
  assert.equal(installed.status, 0, installed.stderr);
  const executable = await fs.lstat(path.join(prefix, "node_modules", "only-my-pi", "bin", "omp.mjs"));
  assert.equal(executable.isFile(), true);
  for (const dependency of ["ajv", "ajv-formats", "semver", "ssri"]) {
    assert.equal((await fs.lstat(path.join(prefix, "node_modules", "only-my-pi", "node_modules", dependency))).isDirectory(), true);
  }
});

test("stack harness safely extracts the dependency-closed artifact and its CLI starts", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp("/tmp/omp-stack-harness-artifact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root], { cwd: process.cwd(), encoding: "utf8", shell: false });
  assert.equal(packed.status, 0, packed.stderr);
  const artifact = path.join(root, packed.stdout.trim().split(/\r?\n/u).at(-1));
  const stage = path.join(root, "stage");
  await fs.mkdir(stage);
  const adapter = createStackHarnessAdapter({ rootDir: process.cwd(), configRoot: path.join(root, "agent") });
  const context = {
    paths: { stage },
    stack: { onlyMyPi: { version: "0.3.0-preview.1", artifactSha256: await hashFile(artifact) } },
  };
  await adapter.stage({
    artifact,
    context,
  });
  const cli = path.join(stage, "only-my-pi", "package", "bin", "omp.mjs");
  assert.equal(context.harnessRoot, path.dirname(path.dirname(cli)));
  assert.equal(adapter.bootstrapFor(context).rootDir, context.harnessRoot);
  const result = spawnSync(process.execPath, [cli, "help"], { cwd: path.dirname(cli), encoding: "utf8", shell: false, env: { PATH: process.env.PATH ?? "", HOME: root } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /omp stack install/u);
});

test("stack harness compiles exact package filters before borrowing the public package tree", async () => {
  const plan = await buildGenerationPlan({ rootDir: process.cwd(), profileId: "daily" });
  const settings = { packages: plan.packages.map((entry) => entry.spec).concat(["npm:pi-memory@0.4.1", "npm:pi-git-sync@0.1.3"]) };
  const compiled = compileStackPackageSettings(settings, plan);
  const filtered = compiled.packages.find((entry) => typeof entry === "object" && entry.source === "npm:pi-agent-extensions@0.5.4");
  assert.deepEqual(filtered.extensions, ["extensions/context/index.ts", "extensions/notify/index.ts", "extensions/review/index.ts", "extensions/sessions/index.ts"]);
  assert.deepEqual(filtered.skills, []);
  assert.ok(compiled.packages.includes("npm:pi-memory@0.4.1"));
  assert.equal(settings.packages.every((entry) => typeof entry === "string"), true);

  const existingOrder = ["extensions/sessions/index.ts", "extensions/context/index.ts", "extensions/review/index.ts", "extensions/notify/index.ts"];
  const borrowed = {
    packages: plan.packages.map((entry) => entry.spec === "npm:pi-agent-extensions@0.5.4"
      ? { source: entry.spec, extensions: existingOrder, skills: [], prompts: [], themes: [] }
      : entry.spec),
  };
  assert.deepEqual(compileStackPackageSettings(borrowed, plan), borrowed);
});
