import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/omp.mjs", import.meta.url));
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-settings-")));
  const config = path.join(root, "config"), project = path.join(root, "A"), other = path.join(root, "B");
  for (const dir of [config, project, other]) await fs.mkdir(dir);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "settings", ...args], { cwd: project, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: config } });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; });
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr })); child.stdin.end();
  });
  const read = async (scope) => { const r = await run(["list", ...(scope ? ["--project", scope] : [])]); assert.equal(r.code, 0, r.stderr); return JSON.parse(r.stdout); };
  return { root, config, project, other, run, read };
}

test("public CLI persists declared defaults, isolates project overrides and resets to inheritance", async t => {
  const f = await fixture(t), initial = await f.read();
  assert.equal(initial.revision, 0);
  const change = await f.run(["set", "context-doctor", "--revision", "0", "--parameters", '{"label":"product"}']);
  assert.equal(change.code, 0, change.stderr);
  const override = await f.run(["set", "context-doctor", "--project", f.project, "--revision", "1", "--parameters", '{"label":"project-A"}']);
  assert.equal(override.code, 0, override.stderr);
  const resource = s => s.resources.find(r => r.id === "context-doctor");
  assert.equal(resource(await f.read(f.project)).parameters.label, "project-A");
  assert.equal(resource(await f.read(f.other)).parameters.label, "product");
  assert.equal(resource(await f.read(f.project)).source, "project");
  const reset = await f.run(["reset", "context-doctor", "--project", f.project, "--revision", "2"]);
  assert.equal(reset.code, 0, reset.stderr);
  assert.equal(resource(await f.read(f.project)).parameters.label, "product");
  assert.equal(resource(await f.read(f.project)).source, "default");
});

test("two real CLI processes enforce CAS and failed requests preserve the last valid settings", async t => {
  const f = await fixture(t);
  const results = await Promise.all(["writer-one", "writer-two"].map(label => f.run(["set", "context-doctor", "--revision", "0", "--parameters", JSON.stringify({ label })])));
  assert.equal(results.filter(r => r.code === 0).length, 1);
  assert.match(results.find(r => r.code !== 0).stderr, /SETTINGS_REVISION_CONFLICT/);
  const winner = await f.read(); assert.equal(winner.revision, 1);
  for (const [id, flags, code] of [
    ["omp-direct", ["--enabled", "false"], "RESOURCE_REQUIRED"],
    ["unknown", ["--enabled", "true"], "RESOURCE_SOURCE_UNKNOWN"],
    ["grep", ["--parameters", '{"arbitrary":"value"}'], "RESOURCE_SCHEMA_UNAVAILABLE"],
    ["context-doctor", ["--parameters", '{"label":"bad\\nlabel"}'], "RESOURCE_PARAMETERS_INVALID"],
  ]) {
    const result = await f.run(["set", id, "--revision", "1", ...flags]);
    assert.notEqual(result.code, 0); assert.match(result.stderr, new RegExp(code));
    assert.deepEqual(await f.read(), winner);
  }
  const file = path.join(f.root, "SKILL.md"), text = "---\nname: example\ndescription: Example explicit skill\ncompatibility: pi-9.9.9\n---\nExample only.\n";
  await fs.writeFile(file, text);
  const incompatible = await f.run(["preview", file]); assert.notEqual(incompatible.code, 0); assert.match(incompatible.stderr, /RESOURCE_INCOMPATIBLE/);
  assert.equal(await fs.readFile(file, "utf8"), text);
  assert.deepEqual(await f.read(), winner);
});

test("public import rejects YAML names that coerce to valid strings", async t => {
  const f = await fixture(t), file = path.join(f.root, "SKILL.md");
  for (const name of ["[example]", "true", "{ example: value }"]) {
    await fs.writeFile(file, `---\nname: ${name}\ndescription: Invalid name type\ncompatibility: pi-1.3.0\n---\nExample.\n`);
    const result = await f.run(["preview", file]);
    assert.notEqual(result.code, 0, result.stdout);
    assert.match(result.stderr, /SKILL_DECLARATION_INVALID/);
  }
  assert.equal((await f.read()).revision, 0);
});

test("public CLI rejects project capacity before replacing the last readable configuration", async t => {
  const f = await fixture(t), file = path.join(f.config, "only-my-pi/product-settings/config.json");
  const state = { version: 1, revision: 0, defaults: {}, projects: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`project-${i}`, {}])), skills: {}, revoked: {} };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(state); await fs.writeFile(file, bytes, { mode: 0o600 });
  const result = await f.run(["set", "context-doctor", "--project", f.project, "--revision", "0", "--parameters", '{"label":"extra"}']);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /SETTINGS_CAPACITY/);
  assert.equal(await fs.readFile(file, "utf8"), bytes);
  assert.equal((await f.read()).revision, 0);
});
