import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { hashPackageContentTree } from "../packages/release-stack/index.mjs";

const exec = promisify(execFile);

async function fixture(t) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-package-content-")));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "package");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "example-package", version: "1.0.0" })}\n`);
  await fs.writeFile(path.join(root, "index.js"), "export default 1;\n");
  return { parent, root };
}

test("package content identity ignores dependency placement but binds owned bytes and contained links", async (t) => {
  const { root } = await fixture(t);
  const initial = await hashPackageContentTree(root);
  await fs.mkdir(path.join(root, "node_modules", "dependency"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "dependency", "index.js"), "layout only\n");
  assert.equal(await hashPackageContentTree(root), initial);

  await fs.symlink("index.js", path.join(root, "index-link.js"));
  const linked = await hashPackageContentTree(root);
  assert.notEqual(linked, initial);
  await fs.appendFile(path.join(root, "index.js"), "// drift\n");
  assert.notEqual(await hashPackageContentTree(root), linked);
});

test("package content identity rejects unsafe roots, manifests, dependencies, and links", async (t) => {
  await assert.rejects(hashPackageContentTree("relative"), TypeError);
  await assert.rejects(hashPackageContentTree(path.join(os.tmpdir(), "missing-omp-package-content")), { code: "PACKAGE_CONTENT_ROOT_UNSAFE" });

  const rootLink = await fixture(t);
  await fs.symlink(rootLink.root, path.join(rootLink.parent, "package-link"));
  await assert.rejects(hashPackageContentTree(path.join(rootLink.parent, "package-link")), { code: "PACKAGE_CONTENT_ROOT_UNSAFE" });
  await fs.symlink(path.join(rootLink.parent, "missing-target"), path.join(rootLink.parent, "dangling-package-link"));
  await assert.rejects(hashPackageContentTree(path.join(rootLink.parent, "dangling-package-link")), { code: "PACKAGE_CONTENT_ROOT_UNSAFE" });

  const missingManifest = await fixture(t);
  await fs.unlink(path.join(missingManifest.root, "package.json"));
  await assert.rejects(hashPackageContentTree(missingManifest.root), { code: "PACKAGE_CONTENT_MANIFEST_UNSAFE" });

  const manifestLink = await fixture(t);
  await fs.rename(path.join(manifestLink.root, "package.json"), path.join(manifestLink.root, "manifest.json"));
  await fs.symlink("manifest.json", path.join(manifestLink.root, "package.json"));
  await assert.rejects(hashPackageContentTree(manifestLink.root), { code: "PACKAGE_CONTENT_MANIFEST_UNSAFE" });

  const dependencyLink = await fixture(t);
  await fs.symlink(dependencyLink.parent, path.join(dependencyLink.root, "node_modules"));
  await assert.rejects(hashPackageContentTree(dependencyLink.root), { code: "PACKAGE_DEPENDENCY_ROOT_UNSAFE" });

  const escapingLink = await fixture(t);
  await fs.writeFile(path.join(escapingLink.parent, "outside.js"), "outside\n");
  await fs.symlink("../outside.js", path.join(escapingLink.root, "escape.js"));
  await assert.rejects(hashPackageContentTree(escapingLink.root), { code: "PACKAGE_CONTENT_SYMLINK_UNSAFE" });

  const danglingLink = await fixture(t);
  await fs.symlink("missing.js", path.join(danglingLink.root, "dangling.js"));
  await assert.rejects(hashPackageContentTree(danglingLink.root), { code: "PACKAGE_CONTENT_SYMLINK_UNSAFE" });
});

test("package content identity rejects unsupported filesystem entries", async (t) => {
  const { root } = await fixture(t);
  const fifo = path.join(root, "unsupported.fifo");
  await exec("mkfifo", [fifo]);
  await assert.rejects(hashPackageContentTree(root), { code: "PACKAGE_CONTENT_TYPE_UNSUPPORTED" });
});
