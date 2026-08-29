import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import {
  createThinPayloadResolver,
  finalizeStackManifest,
  sha256,
  validateArtifactLedger,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function temporary(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function tree(root, relative) {
  return `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
}

async function packageTree(root, stack) {
  for (const entry of stack.externalPackages) {
    const target = path.join(root, "node_modules", ...entry.name.split("/"));
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "package.json"), `${JSON.stringify({ name: entry.name, version: entry.version })}\n`);
    await fs.writeFile(path.join(target, "index.js"), `${entry.name}\n`);
  }
}

test("Thin resolver downloads every exact artifact, disables scripts, and converges to one resolved stack", async (t) => {
  const root = await temporary(t, "omp-thin-resolver-");
  const payloadRoot = path.join(root, "only-my-pi");
  const expected = path.join(root, "expected");
  await fs.mkdir(path.join(expected, "node", "bin"), { recursive: true });
  await fs.mkdir(path.join(expected, "node", "lib", "node_modules", "npm", "bin"), { recursive: true });
  await fs.writeFile(path.join(expected, "node", "bin", "node"), "fixture node\n", { mode: 0o755 });
  await fs.writeFile(path.join(expected, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js"), "fixture npm\n");
  await fs.mkdir(path.join(expected, "pi", "dist", "bundle"), { recursive: true });
  await fs.writeFile(path.join(expected, "pi", "dist", "bundle", "cli.js"), "fixture Pi\n");
  await fs.writeFile(path.join(expected, "pi", "package.json"), `${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3", devDependencies: { fixture: "1.0.0" } }, null, 2)}\n`);
  await fs.writeFile(path.join(expected, "pi", "npm-shrinkwrap.json"), `${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3", lockfileVersion: 3, packages: { "": { name: "@earendil-works/pi-coding-agent", version: "0.84.3" } } }, null, 2)}\n`);
  await fs.mkdir(path.join(expected, "pi", "node_modules"), { recursive: true });
  await fs.writeFile(path.join(expected, "pi", "node_modules", ".package-lock.json"), `${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3", lockfileVersion: 3, requires: true, packages: {} }, null, 2)}\n`);

  const base = JSON.parse(await fs.readFile(path.join(ROOT, "contracts", "release", "stack-manifest.example.json"), "utf8"));
  await fs.mkdir(path.join(expected, "external-npm"), { recursive: true });
  const dependencies = Object.fromEntries(base.externalPackages.map((entry) => [entry.name, entry.version]).sort(([left], [right]) => left.localeCompare(right)));
  const packageDocument = { name: "only-my-pi-external-stack", private: true, version: "0.0.0", dependencies };
  const ledger = validateArtifactLedger(JSON.parse(await fs.readFile(path.join(ROOT, "contracts", "release", "transitive-artifact-ledger.example.json"), "utf8")));
  const artifacts = new Map(ledger.artifacts.map((entry) => [`${entry.name}@${entry.version}`, entry]));
  const lock = { name: packageDocument.name, version: packageDocument.version, lockfileVersion: 3, requires: true, packages: { "": packageDocument } };
  for (const entry of base.externalPackages) {
    const artifact = artifacts.get(`${entry.name}@${entry.version}`);
    lock.packages[`node_modules/${entry.name}`] = { version: entry.version, resolved: artifact.tarballUrl, integrity: artifact.integrity };
  }
  await fs.writeFile(path.join(expected, "external-npm", "package.json"), `${JSON.stringify(packageDocument, null, 2)}\n`);
  await fs.writeFile(path.join(expected, "external-npm", "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  await packageTree(path.join(expected, "external-npm"), base);
  await fs.writeFile(path.join(expected, "external-npm", "node_modules", ".package-lock.json"), `${JSON.stringify({ name: packageDocument.name, version: packageDocument.version, lockfileVersion: 3, requires: true, packages: Object.fromEntries(Object.entries(lock.packages).filter(([relative]) => relative !== "")) }, null, 2)}\n`);
  await fs.writeFile(path.join(expected, "only-my-pi.tgz"), "fixture OMP\n");
  base.runtime.node.treeDigest = await tree(expected, "node");
  base.runtime.pi.treeDigest = await tree(expected, "pi");
  base.externalTreeDigest = await tree(expected, "external-npm");
  base.onlyMyPi.artifactSha256 = sha256(await fs.readFile(path.join(expected, "only-my-pi.tgz")));
  for (const entry of base.externalPackages) entry.treeDigest = await tree(expected, `external-npm/node_modules/${entry.name}`);
  delete base.stackId;
  const stackManifest = finalizeStackManifest(base);

  await fs.mkdir(path.join(payloadRoot, "resolution", "external"), { recursive: true });
  await fs.copyFile(path.join(expected, "only-my-pi.tgz"), path.join(payloadRoot, "only-my-pi.tgz"));
  await fs.copyFile(path.join(expected, "external-npm", "package.json"), path.join(payloadRoot, "resolution", "external", "package.json"));
  await fs.copyFile(path.join(expected, "external-npm", "package-lock.json"), path.join(payloadRoot, "resolution", "external", "package-lock.json"));

  const downloads = [];
  const commands = [];
  const resolver = createThinPayloadResolver({
    async download(options) { downloads.push(options); await fs.writeFile(options.destination, "verified fixture bytes\n"); },
    async extract({ destination }) {
      if (destination.endsWith("pi-artifact")) await fs.cp(path.join(expected, "pi"), path.join(destination, "package"), { recursive: true });
      else {
        const nodeRoot = path.join(destination, "node-v24.19.0-darwin-arm64");
        await fs.cp(path.join(expected, "node"), nodeRoot, { recursive: true });
      }
    },
    async run(_node, argv, options) {
      commands.push({ argv, env: options.env });
      if (argv[1] === "ci" && options.cwd.endsWith("external-npm")) {
        await packageTree(options.cwd, stackManifest);
        const localized = JSON.parse(await fs.readFile(path.join(options.cwd, "package-lock.json"), "utf8"));
        const packages = Object.fromEntries(Object.entries(localized.packages).filter(([relative]) => relative !== ""));
        await fs.writeFile(path.join(options.cwd, "node_modules", ".package-lock.json"), `${JSON.stringify({ name: packageDocument.name, version: packageDocument.version, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`);
      }
      if (argv[1] === "ci" && options.cwd.endsWith("pi")) {
        const localized = JSON.parse(await fs.readFile(path.join(options.cwd, "npm-shrinkwrap.json"), "utf8"));
        const packages = Object.fromEntries(Object.entries(localized.packages).filter(([relative]) => relative !== ""));
        await fs.writeFile(path.join(options.cwd, "node_modules", ".package-lock.json"), `${JSON.stringify({ name: localized.name, version: localized.version, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`);
      }
      return { ok: true };
    },
  });
  const resolved = await resolver({ payloadRoot, cacheRoot: root, inspection: { stackManifest }, metadata: { ledger } });
  assert.equal(await tree(resolved, "node"), stackManifest.runtime.node.treeDigest);
  assert.equal(await tree(resolved, "pi"), stackManifest.runtime.pi.treeDigest);
  assert.equal(await tree(resolved, "external-npm"), stackManifest.externalTreeDigest);
  assert.equal(downloads.length, ledger.artifacts.length + 1);
  assert.equal(commands.filter((entry) => entry.argv[1] === "cache").length, 0);
  assert.equal(commands.filter((entry) => entry.argv[1] === "ci").length, 2);
  assert.equal(commands.some((entry) => entry.argv[1] === "install"), false);
  assert.equal(commands.some((entry) => entry.argv.includes("--ignore-scripts") && entry.argv.includes("--offline")), true);
  assert.ok(commands.every((entry) => entry.env.npm_config_ignore_scripts === "true" && entry.env.npm_config_offline === "true"));
  assert.ok(commands.every((entry) => !Object.keys(entry.env).some((key) => /TOKEN|AUTH|PASSWORD|COOKIE|SECRET|KEY/iu.test(key))));
});
