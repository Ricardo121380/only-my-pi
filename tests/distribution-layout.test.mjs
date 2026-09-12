import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { materializeExecutableLinks } from "../packages/distribution/npm-layout.mjs";
import { stagePiBranding } from "../packages/distribution/pi-branding.mjs";

test("native Pi branding preserves original identity and includes offline UI assets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi-assets-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = { name: "pi-engine", version: "0.84.3", piConfig: { configDir: ".pi" } };
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(original));
  for (const entry of ["README.md", "CHANGELOG.md", "docs/guide.md", "examples/sample.js",
    "dist/modes/interactive/theme/dark.json", "dist/modes/interactive/assets/logo.txt", "dist/core/export-html/template.html"]) {
    await fs.mkdir(path.dirname(path.join(root, entry)), { recursive: true });
    await fs.writeFile(path.join(root, entry), entry);
  }
  await stagePiBranding(root);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")), original);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "omp-assets/package.json"), "utf8")),
    { ...original, piConfig: { name: "omp", configDir: ".pi" } });
  assert.equal(await fs.readFile(path.join(root, "omp-assets/dist/core/export-html/template.html"), "utf8"),
    "dist/core/export-html/template.html");
  await assert.rejects(stagePiBranding(root), { code: "EEXIST" });
});

test("npm-portable bin wrappers retain relative imports and arguments in paths with spaces", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp bin links ")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "node_modules/.bin"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules/example/lib"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules/example/lib/value.mjs"), "export default 42;\n");
  await fs.writeFile(path.join(root, "node_modules/example/lib/cli.mjs"), '#!/usr/bin/env node\nimport value from "./value.mjs"; console.log(JSON.stringify([value,...process.argv.slice(2)]));\n', { mode: 0o755 });
  const bin = path.join(root, "node_modules/.bin/example");
  await fs.symlink("../example/lib/cli.mjs", bin);
  const changes = await materializeExecutableLinks(root);
  assert.deepEqual(changes, [{ path: "node_modules/.bin/example", target: "node_modules/example/lib/cli.mjs" }]);
  assert.equal((await fs.lstat(bin)).isFile(), true);
  const result = await promisify(execFile)(bin, ["a b", "$(not-executed)", "quote'"], { cwd: os.tmpdir(),
    env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` } });
  assert.deepEqual(JSON.parse(result.stdout), [42, "a b", "$(not-executed)", "quote'"]);
  assert.deepEqual(await materializeExecutableLinks(root), []);
});

test("unreviewed symlink shapes are rejected without copying outside data", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-link-deny-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink("/etc/hosts", path.join(root, "external"));
  await assert.rejects(materializeExecutableLinks(root), { code: "DISTRIBUTION_SYMLINK_UNSUPPORTED" });
  assert.equal((await fs.lstat(path.join(root, "external"))).isSymbolicLink(), true);
});
