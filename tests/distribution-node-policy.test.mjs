import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-node-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("source CLI and independent npm loader reject unsupported Node before payload or user state access", async (t) => {
  const directory = await temporary(t);
  await fs.copyFile(path.join(root, "distribution/npm/loader.mjs"), path.join(directory, "loader.mjs"));
  await fs.copyFile(path.join(root, "packages/bootstrap/resource-hash.mjs"), path.join(directory, "resource-hash.mjs"));
  for (const entry of ["source", "npm"]) for (const version of ["22.19.0", "24.18.9", "24.19.0-rc.1", "25.0.0", "26.0.0", "24.19.0", "24.20.0"]) {
    const supported = ["24.19.0", "24.20.0"].includes(version);
    const module = pathToFileURL(entry === "source" ? path.join(root, "bin/omp.mjs") : path.join(directory, "loader.mjs")).href;
    const code = `Object.defineProperty(process.versions, "node", {value:${JSON.stringify(version)}});
      const api = await import(${JSON.stringify(module)});
      if (${JSON.stringify(entry)} === "source") process.exitCode = await api.runOmpEntrypoint({argv:["--version"]});
      else { try { await api.locateRuntime(); } catch (e) { console.error(e.code ?? e.message); process.exitCode=1; } }`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 15000,
      env: { PATH: process.env.PATH, HOME: path.join(directory, "unused-home") } });
    assert.ifError(result.error);
    if (!supported) { assert.equal(result.status, 1); assert.match(result.stderr, /Node >=24\.19\.0 <25/u); }
    else if (entry === "source") { assert.equal(result.status, 0); assert.match(result.stdout, /^only-my-pi /u); }
    else { assert.equal(result.status, 1); assert.match(result.stderr, /ENOENT/u); }
  }
  await assert.rejects(fs.stat(path.join(directory, "unused-home")), { code: "ENOENT" });
});

test("tag promotion planning accepts one Node 24 receipt and refuses a Node 22 substitute", async (t) => {
  const directory = await temporary(t);
  const version = "0.4.0-preview.1", sourceCommit = "a".repeat(40), distributionId = `sha256:${"b".repeat(64)}`;
  const artifacts = [], registry = {};
  for (const name of ["only-my-pi-runtime-darwin-arm64", "only-my-pi"]) {
    const bytes = Buffer.from(name), filename = `${name}-${version}.tgz`;
    await fs.writeFile(path.join(directory, filename), bytes);
    artifacts.push({ name, filename, sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` });
    registry[name] = { versions: { [version]: { dist: {
      integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`,
      attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
    } } }, "dist-tags": {} };
  }
  await fs.writeFile(path.join(directory, "build-receipt.json"), JSON.stringify({ version, sourceCommit, distributionId, artifacts }));
  const receipt = path.join(directory, "acceptance.json");
  const acceptance = { status: "PUBLIC_INSTALL_ACCEPTANCE_PASS", publicRegistryVerified: true, node: "24.19.0",
    selector: `only-my-pi@${version}`, sourceCommit, distributionId, checks: Array.from({ length: 9 }, () => ({ exitCode: 0 })) };
  await fs.writeFile(receipt, JSON.stringify(acceptance));
  const preload = path.join(directory, "registry.mjs");
  await fs.writeFile(preload, `const registry=${JSON.stringify(registry)}; globalThis.fetch=async value=>{
    const url=new URL(value); const data=registry[url.pathname.slice(1)];
    if(url.origin!=="https://registry.npmjs.org" || !data) throw new Error("unexpected network request");
    return Response.json(data); };`);
  const run = () => spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/promote-distribution-tags.mjs"), directory, receipt],
    { encoding: "utf8", timeout: 15000, env: { PATH: process.env.PATH, HOME: directory } });
  const accepted = run(); assert.ifError(accepted.error); assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).status, "TAG_PROMOTION_PLAN");
  await fs.writeFile(receipt, JSON.stringify({ ...acceptance, node: "22.19.0" }));
  const refused = run(); assert.ifError(refused.error); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /exact public installation acceptance is missing for Node 24\.19\.0/u);
  await assert.rejects(fs.stat(path.join(directory, "npm-default-tags.json")), { code: "ENOENT" });
});
