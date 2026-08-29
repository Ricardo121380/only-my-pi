#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PUBLIC_STACK_PACKAGES, sha256 } from "../packages/release-stack/index.mjs";
import { M10_EXACT_PACKAGE_TARGET } from "../packages/upstream-migration/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(ROOT, "contracts", "release", "external");
const SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function run(command, args, { cwd, env }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    const collect = (chunk) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) child.kill("SIGTERM");
      else chunks.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(Object.assign(new Error("npm lock generation failed"), { code: "M11_LOCK_NPM_FAILED", outputDigest: sha256(Buffer.concat(chunks)) })));
  });
}

export function validateM11ExternalLock(lock, document) {
  if (lock?.lockfileVersion !== 3 || !lock.packages || !lock.packages[""]) fail("M11_LOCK_INVALID", "external lock must use npm lockfileVersion 3");
  const expected = Object.fromEntries(PUBLIC_STACK_PACKAGES.map(({ name, version }) => [name, version]).sort(([left], [right]) => left.localeCompare(right)));
  if (JSON.stringify(lock.packages[""].dependencies) !== JSON.stringify(expected) || JSON.stringify(document.dependencies) !== JSON.stringify(expected)) fail("M11_LOCK_TUPLE_DRIFT", "external lock root differs from the exact nine-package tuple");
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (relative === "") continue;
    if (/(?:^|\/)node_modules\/@earendil-works\/pi-/u.test(relative)) fail("M11_LOCK_PEER_RUNTIME_PRESENT", "external lock must not resolve a second Pi runtime");
    if (!relative.includes("node_modules/") || entry?.link === true || typeof entry?.version !== "string"
      || typeof entry?.resolved !== "string" || !SRI.test(entry?.integrity ?? "")) fail("M11_LOCK_ENTRY_INVALID", `external lock entry lacks immutable registry evidence: ${relative}`);
    const url = new URL(entry.resolved);
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".tgz")) fail("M11_LOCK_URL_INVALID", `external lock URL is unsafe: ${relative}`);
  }
  const integrity = new Map(M10_EXACT_PACKAGE_TARGET.map((entry) => [entry.name, entry.toIntegrity]));
  for (const { name, version } of PUBLIC_STACK_PACKAGES) {
    const entry = lock.packages[`node_modules/${name}`];
    if (entry?.version !== version || entry.integrity !== integrity.get(name)) fail("M11_LOCK_DIRECT_EVIDENCE_DRIFT", `external lock direct evidence drifted: ${name}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (JSON.stringify(argv) === JSON.stringify(["--check"])) {
    const [document, lock] = await Promise.all([
      fs.readFile(path.join(TARGET, "package.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(TARGET, "package-lock.json"), "utf8").then(JSON.parse),
    ]);
    validateM11ExternalLock(lock, document);
    return { ok: true, status: "M11_EXTERNAL_LOCK_VALID", mutation: false, packageCount: Object.keys(lock.packages).length - 1, lockDigest: sha256(JSON.stringify(lock)) };
  }
  if (JSON.stringify(argv) !== JSON.stringify(["--write", "--yes"])) return { ok: true, status: "M11_EXTERNAL_LOCK_PLAN", mutation: false, network: true, lifecycleScripts: false, target: "contracts/release/external" };
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-m11-lock-")));
  try {
    const work = path.join(temporary, "work");
    const home = path.join(temporary, "home");
    const cache = path.join(temporary, "cache");
    await Promise.all([work, home, cache].map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
    const dependencies = Object.fromEntries(PUBLIC_STACK_PACKAGES.map(({ name, version }) => [name, version]).sort(([left], [right]) => left.localeCompare(right)));
    const document = { name: "only-my-pi-external-stack", version: "0.0.0", private: true, dependencies };
    await fs.writeFile(path.join(work, "package.json"), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    const userNpmrc = path.join(temporary, "user.npmrc");
    const globalNpmrc = path.join(temporary, "global.npmrc");
    const npmrc = "audit=false\nfund=false\nignore-scripts=true\nregistry=https://registry.npmjs.org/\nupdate-notifier=false\n";
    await Promise.all([userNpmrc, globalNpmrc].map((file) => fs.writeFile(file, npmrc, { mode: 0o600 })));
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: temporary,
      LC_ALL: "C",
      NO_COLOR: "1",
      npm_config_cache: cache,
      npm_config_userconfig: userNpmrc,
      npm_config_globalconfig: globalNpmrc,
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    };
    await run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--omit=peer", "--legacy-peer-deps", "--no-audit", "--no-fund", "--save-exact"], { cwd: work, env });
    const lock = JSON.parse(await fs.readFile(path.join(work, "package-lock.json"), "utf8"));
    validateM11ExternalLock(lock, document);
    await run("npm", ["ci", "--ignore-scripts", "--omit=peer", "--legacy-peer-deps", "--no-audit", "--no-fund"], { cwd: work, env });
    for (const { name, version } of PUBLIC_STACK_PACKAGES) {
      const manifest = JSON.parse(await fs.readFile(path.join(work, "node_modules", ...name.split("/"), "package.json"), "utf8"));
      if (manifest.name !== name || manifest.version !== version) fail("M11_LOCK_INSTALL_DRIFT", `installed package differs from the exact tuple: ${name}`);
    }
    await fs.mkdir(TARGET, { recursive: true, mode: 0o755 });
    await fs.writeFile(path.join(TARGET, "package.json"), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o644 });
    await fs.writeFile(path.join(TARGET, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o644 });
    return { ok: true, status: "M11_EXTERNAL_LOCK_WRITTEN", mutation: true, packageCount: Object.keys(lock.packages).length - 1, lockDigest: sha256(JSON.stringify(lock)) };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, status: "M11_EXTERNAL_LOCK_FAILED", code: error?.code ?? "M11_EXTERNAL_LOCK_FAILED", message: error?.message }, null, 2)}\n`); process.exitCode = 1; }
}
