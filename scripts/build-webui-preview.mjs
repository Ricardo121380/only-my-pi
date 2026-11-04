import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createDeterministicTarGzip, hashFile as taggedHashFile } from "../packages/release-stack/deterministic-archive.mjs";
import { downloadVerified } from "../packages/release-stack/downloader.mjs";
import { EMBEDDED_NODE_ARCHIVE_SHA256 } from "../packages/release-stack/contracts.mjs";
import { prepareBundledPty, verifyBundledRuntime } from "../packages/release-stack/release-payload-stager.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const json = async file => JSON.parse(await fs.readFile(file, "utf8"));
const save = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const hashFile = async file => (await taggedHashFile(file)).slice(7);
const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
const run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: "inherit" });
  child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`)));
});

async function filesIn(root) {
  const result = {};
  async function walk(directory) {
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, item.name), name = path.relative(root, file).split(path.sep).join("/");
      if (item.isSymbolicLink()) {
        const link = await fs.readlink(file), real = await fs.realpath(file);
        if (path.isAbsolute(link) || path.relative(root, real).startsWith("..")) throw new Error(`Escaping payload link: ${name}`);
        result[name] = { link };
      } else if (item.isDirectory()) await walk(file);
      else if (item.isFile()) result[name] = { sha256: await hashFile(file) };
      else throw new Error(`Unsupported payload entry: ${name}`);
    }
  }
  await walk(root); return result;
}

async function sbom(app, version, sourceCommit, createdAt) {
  const records = [];
  for (const [prefix, directory] of [["runtime", app], ["extensions", path.join(app, "contracts/release/external")]]) {
    const lock = await json(path.join(directory, "package-lock.json"));
    for (const [relative, binding] of Object.entries(lock.packages)) {
      if (!relative.includes("node_modules/")) continue;
      const pkg = await json(path.join(directory, relative, "package.json")).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (!pkg) continue;
      if (pkg.version !== binding.version) throw new Error(`Installed package differs from lock: ${relative}`);
      if (typeof pkg.license !== "string" && typeof binding.license !== "string") throw new Error(`Missing package license: ${pkg.name}`);
      const license = pkg.license ?? binding.license;
      records.push({ name: pkg.name, version: pkg.version, license, location: `${prefix}/${relative}`, resolved: binding.resolved, integrity: binding.integrity });
    }
  }
  for (const pkg of await json(path.join(app, "webui-preview-assets/dependencies.json"))) records.push({ ...pkg, location: `frontend/${pkg.name}`, resolved: "NOASSERTION" });
  const packages = records.map((pkg, i) => ({ SPDXID: `SPDXRef-Package-${i}`, name: pkg.name, versionInfo: pkg.version, downloadLocation: pkg.resolved ?? "NOASSERTION", filesAnalyzed: false,
    licenseDeclared: pkg.license, licenseConcluded: "NOASSERTION", copyrightText: "NOASSERTION",
    comment: `${pkg.location}; registry integrity=${pkg.integrity ?? "frontend bundled; see shipped notices"}; lifecycle scripts disabled`,
  }));
  packages.push({ SPDXID: "SPDXRef-Node", name: "Node.js", versionInfo: "24.19.0", downloadLocation: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz", filesAnalyzed: false,
    licenseDeclared: "MIT", licenseConcluded: "NOASSERTION", copyrightText: "NOASSERTION", checksums: [{ algorithm: "SHA256", checksumValue: EMBEDDED_NODE_ARCHIVE_SHA256.slice(7) }], comment: "Full Node license and bundled dependency notices are in node/LICENSE." });
  return { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: `only-my-pi-webui-${version}`, documentNamespace: `https://github.com/Ricardo121380/only-my-pi/webui-preview/${sourceCommit}`,
    creationInfo: { created: createdAt, creators: ["Tool: only-my-pi-webui-preview"] }, documentDescribes: packages.map(pkg => pkg.SPDXID), packages,
    relationships: packages.map(pkg => ({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: pkg.SPDXID })),
  };
}

export async function buildWebPreview({ output, version = "0.1.0-preview.1" } = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64" || process.version !== "v24.19.0") throw new Error("Build on native macOS arm64 with Node 24.19.0");
  if (version !== "0.1.0-preview.1" || !path.isAbsolute(output ?? "")) throw new Error("Use WebUI 0.1.0-preview.1 and a fresh absolute output directory");
  const sourceCommit = git("rev-parse", "HEAD"), sourceTree = git("rev-parse", "HEAD^{tree}");
  if (git("status", "--porcelain")) throw new Error("Preview source must be clean and committed");
  await fs.mkdir(output, { recursive: false });
  const rootName = "only-my-pi-webui", payload = path.join(output, rootName), app = path.join(payload, "app"), home = path.join(output, "build-home");
  await fs.mkdir(app, { recursive: true }); await fs.mkdir(home);
  const sourceTar = path.join(output, "source.tar"); git("archive", "--format=tar", `--output=${sourceTar}`, sourceCommit);
  await run("/usr/bin/tar", ["-xf", sourceTar, "-C", app], {});
  const nodeArchive = path.join(output, "node.tar.gz");
  await downloadVerified({ url: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz", destination: nodeArchive, expectedSha256: EMBEDDED_NODE_ARCHIVE_SHA256, maxBytes: 64 * 1024 * 1024 });
  await run("/usr/bin/tar", ["-xzf", nodeArchive, "-C", payload], {}); await fs.rename(path.join(payload, "node-v24.19.0-darwin-arm64"), path.join(payload, "node"));
  const node = path.join(payload, "node/bin/node"), npm = path.join(payload, "node/lib/node_modules/npm/bin/npm-cli.js");
  const env = { PATH: `${path.dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: process.env.TMPDIR ?? "/tmp", LANG: "en_US.UTF-8", CI: "1", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", NPM_CONFIG_USERCONFIG: "/dev/null", NPM_CONFIG_GLOBALCONFIG: "/dev/null", NPM_CONFIG_CACHE: path.join(output, "npm-cache"), NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" };
  for (const [directory, extra] of [[app, []], [path.join(app, "contracts/release/external"), ["--omit=peer", "--legacy-peer-deps"]], [path.join(app, "prototypes"), []]]) await run(node, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", ...extra], { cwd: directory, env });
  await run(node, [npm, "run", "build:web:b2"], { cwd: app, env });
  await fs.rename(path.join(app, "prototypes/dist-host"), path.join(app, "webui-preview-assets"));
  await fs.rm(path.join(app, "prototypes/node_modules"), { recursive: true });
  await prepareBundledPty(app); await verifyBundledRuntime({ packageRoot: app, node, env });
  const createdAt = new Date(git("show", "-s", "--format=%cI", sourceCommit)).toISOString();
  const components = await sbom(app, version, sourceCommit, createdAt);
  await save(path.join(payload, "sbom.spdx.json"), components);
  await fs.copyFile(path.join(app, "LICENSE"), path.join(payload, "LICENSE"));
  await fs.writeFile(path.join(payload, "start.command"), '#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ROOT/node/bin/node" "$ROOT/app/scripts/webui-preview.mjs" "$@"\n', { flag: "wx", mode: 0o755 });
  await fs.copyFile(path.join(app, "docs/releases/webui-0.1.0-preview.1.md"), path.join(payload, "README.md"));
  const files = await filesIn(payload);
  const startupFiles = Object.keys(files).filter(name => name === "node/bin/node" || name === "start.command" || name.startsWith("app/webui-preview-assets/") || /^app\/(?:packages|extensions|scripts)\//u.test(name) || ["app/.node-version", "app/package.json", "app/package-lock.json", "app/contracts/release/external/package-lock.json", "app/node_modules/@earendil-works/pi-coding-agent/package.json"].includes(name));
  const manifest = { kind: "only-my-pi-webui-preview-v1", version, tag: `webui-v${version}`, platform: "darwin-arm64", sourceCommit, sourceTree, createdAt, node: "24.19.0", pi: "1.5.0", modelPolicy: "deepseek-only", subagents: "readonly-omp-explorer", lifecycleScriptsExecuted: false, startupFiles, files };
  await save(path.join(payload, "preview-manifest.json"), manifest);
  await run(node, [path.join(app, "scripts/webui-preview.mjs"), "--check"], { cwd: app, env });
  const name = `only-my-pi-webui-${version}-darwin-arm64.tar.gz`, archive = path.join(output, name);
  await createDeterministicTarGzip({ rootDir: payload, outputPath: archive, rootName });
  await fs.copyFile(path.join(payload, "preview-manifest.json"), path.join(output, "preview-manifest.json"));
  await fs.copyFile(path.join(payload, "sbom.spdx.json"), path.join(output, "sbom.spdx.json"));
  await fs.copyFile(path.join(payload, "README.md"), path.join(output, "README.md"));
  const receipt = { kind: "only-my-pi-webui-build-v1", sourceCommit, sourceTree, version, tag: manifest.tag, platform: manifest.platform, archive: name, sha256: await hashFile(archive), fileCount: Object.keys(files).length, packageCount: components.packages.length, node: manifest.node, pi: manifest.pi, runtimeVerified: true, scriptsDisabled: true };
  await save(path.join(output, "build-receipt.json"), receipt);
  const names = [name, "preview-manifest.json", "sbom.spdx.json", "README.md", "build-receipt.json"];
  const sums = await Promise.all(names.map(async name => `${await hashFile(path.join(output, name))}  ${name}`));
  await fs.writeFile(path.join(output, "SHA256SUMS"), sums.join("\n") + "\n", { flag: "wx" });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildWebPreview({ output: process.argv[2], version: process.argv[3] ?? "0.1.0-preview.1" }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
