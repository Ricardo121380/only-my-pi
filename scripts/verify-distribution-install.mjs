import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { hashFile } from "../packages/release-stack/deterministic-archive.mjs";
import { verifyInstalledMigration } from "./lib/installed-migration-acceptance.mjs";

const execFile = promisify(callback);
const [build, output, registryMode] = process.argv.slice(2);
if (!path.isAbsolute(build ?? "") || !path.isAbsolute(output ?? "") || ![undefined, "--public-exact", "--public-default"].includes(registryMode))
  throw new Error("Usage: node scripts/verify-distribution-install.mjs /absolute/build /fresh/output [--public-exact|--public-default]");
await fs.mkdir(output, { recursive: false });
const receipt = JSON.parse(await fs.readFile(path.join(build, "build-receipt.json"), "utf8"));
const distributionId = receipt.platforms?.[`${process.platform}-${process.arch}`]?.distributionId ?? receipt.distributionId;
if (!/^sha256:[a-f0-9]{64}$/u.test(distributionId ?? "")) throw new Error("current platform identity is missing");
const packages = new Map();
for (const artifact of receipt.artifacts) {
  if (path.basename(artifact.filename) !== artifact.filename || await hashFile(path.join(build, artifact.filename)) !== artifact.sha256)
    throw new Error("candidate bytes differ from the build receipt");
  const bytes = await fs.readFile(path.join(build, artifact.filename));
  const manifest = JSON.parse((await execFile("tar", ["-xOzf", path.join(build, artifact.filename), "package/package.json"], { maxBuffer: 1024 * 1024 })).stdout);
  packages.set(artifact.name, { artifact, bytes, manifest });
}
const requests = [];
let registry;
const server = http.createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  const name = decodeURIComponent(request.url.split("?")[0].slice(1));
  const pkg = packages.get(name);
  const archive = [...packages.values()].find((entry) => name === entry.artifact.filename);
  if (pkg) {
    response.setHeader("content-type", "application/json");
    const version = { ...pkg.manifest, dist: { tarball: `${registry}${pkg.artifact.filename}`,
      integrity: `sha512-${crypto.createHash("sha512").update(pkg.bytes).digest("base64")}` } };
    response.end(JSON.stringify({ name, "dist-tags": { latest: receipt.version, preview: receipt.version }, versions: { [receipt.version]: version } }));
  } else if (archive) response.end(archive.bytes);
  else { response.statusCode = 404; response.end(JSON.stringify({ error: "Unknown test artifact" })); }
});
if (!registryMode) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
registry = registryMode ? "https://registry.npmjs.org/" : `http://127.0.0.1:${server.address().port}/`;
const selector = registryMode === "--public-exact" ? `only-my-pi@${receipt.version}` : "only-my-pi";
const home = path.join(output, "home");
const prefix = path.join(output, "prefix");
await fs.mkdir(home);
const env = { HOME: home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
  npm_config_cache: path.join(output, "cache"), npm_config_registry: registry,
  npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
const npm = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
const checks = [];
async function run(label, executable, args, extraEnv = {}) {
  const result = await execFile(executable, args, { cwd: home, env: { ...env, ...extraEnv }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  await fs.writeFile(path.join(output, `${label}.log`), result.stdout + result.stderr);
  checks.push({ label, exitCode: 0 });
  return result.stdout;
}
try {
  await run("global-install", process.execPath, [npm, "install", "--global", "--prefix", prefix, selector]);
  const omp = path.join(prefix, "bin/omp");
  const offline = async (label, args) => process.platform === "darwin"
    ? run(label, "/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", omp, ...args])
    : run(label, "/usr/bin/bwrap", ["--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent",
      "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--", omp, ...args]);
  await offline("verify-offline", ["--verify-install"]);
  if (!(await offline("version-offline", ["--version"])).includes(`only-my-pi ${receipt.version}`)) throw new Error("wrong OMP version");
  const doctor = JSON.parse(await offline("doctor-offline", ["admin", "doctor", "--json"]));
  if (!doctor.ok || doctor.sourceCommit !== receipt.sourceCommit || doctor.distributionId !== distributionId) throw new Error("doctor identity differs");
  if ((await offline("raw-pi-offline", ["admin", "pi", "--version"])).trim() !== "0.84.3") throw new Error("wrong bundled Pi");
  try { await fs.lstat(path.join(home, ".pi")); throw new Error("read-only commands initialized user config"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const npxVersion = await run("npx-fresh-cache", process.execPath, [npm, "exec", "--yes", "--", selector, "--version"],
    { npm_config_cache: path.join(output, "npx-cache") });
  if (!npxVersion.includes(`only-my-pi ${receipt.version}`)) throw new Error("fresh npx did not run the candidate");
  const saved = path.join(home, ".pi/agent/sessions/preserve-fixture.txt");
  await fs.mkdir(path.dirname(saved), { recursive: true });
  await fs.writeFile(saved, "preserved session fixture\n");
  await run("global-uninstall", process.execPath, [npm, "uninstall", "--global", "--prefix", prefix, "only-my-pi"]);
  try { await fs.lstat(omp); throw new Error("uninstall left the command installed"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (await fs.readFile(saved, "utf8") !== "preserved session fixture\n") throw new Error("uninstall changed user data");
  const productUpgrade = receipt.version === "0.4.0-preview.2" && process.platform === "darwin";
  if (productUpgrade) {
    await run("global-install-previous", process.execPath, [npm, "install", "--global", "--prefix", prefix,
      "only-my-pi@0.4.0-preview.1", "--registry", "https://registry.npmjs.org"]);
    const previous = JSON.parse((await execFile(omp, ["admin", "version", "--json"], { cwd: home, env, timeout: 60_000 })).stdout);
    if (previous.packageVersion !== "0.4.0-preview.1" || previous.sourceCommit !== "38e71adc8c2c52cc332db288f5dcdd14f73bd8cb")
      throw new Error("previous public npm version differs");
  }
  await run("global-reinstall", process.execPath, [npm, "install", "--global", "--prefix", prefix, selector]);
  await offline("reinstall-verify-offline", ["--verify-install"]);
  if (productUpgrade) {
    const upgraded = JSON.parse(await offline("upgrade-version-offline", ["admin", "version", "--json"]));
    if (upgraded.sourceCommit !== receipt.sourceCommit || upgraded.distributionId !== distributionId) throw new Error("npm upgrade identity differs");
  }
  if (await fs.readFile(saved, "utf8") !== "preserved session fixture\n") throw new Error("reinstall changed user data");
  if (receipt.version === "0.4.0-preview.2") {
    const migration = await verifyInstalledMigration({ command: omp, home, env, sourceCommit: receipt.sourceCommit, distributionId });
    if (await fs.readFile(saved, "utf8") !== "preserved session fixture\n") throw new Error("migration changed user data");
    await fs.writeFile(path.join(output, "migration.json"), JSON.stringify(migration, null, 2));
  }
  const status = registryMode ? "PUBLIC_INSTALL_ACCEPTANCE_PASS" : "LOCAL_INSTALL_ACCEPTANCE_PASS";
  await fs.writeFile(path.join(output, "acceptance.json"), JSON.stringify({ formatVersion: 1, status,
    publicRegistryVerified: Boolean(registryMode), selector, protectedProductAcceptance: false, sourceCommit: receipt.sourceCommit,
    ...(receipt.version === "0.4.0-preview.2" ? { version: receipt.version, platform: `${process.platform}-${process.arch}`, productUpgrade } : {}),
    distributionId, node: process.versions.node, checks, requests }, null, 2));
  console.log(JSON.stringify({ status, checks: checks.length, output }));
} finally {
  if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
