import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hashResourcePath } from "../packages/bootstrap/resource-hash.mjs";

test("resource tree hashing preserves the historical byte format and reads fresh contents", async t => {
  const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-tree-order-"));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  const root = path.join(artifactRoot, "resource");
  await fs.mkdir(path.join(root, "b"), { recursive: true });
  await fs.writeFile(path.join(root, "z.txt"), "tail\n");
  await fs.writeFile(path.join(root, "b/utf8.txt"), "值\0");
  await fs.writeFile(path.join(root, "a-empty"), "");
  await fs.symlink("b/utf8.txt", path.join(root, "c-link"));
  const options = { artifactRoot, relativePath: "resource", allowContainedSymlinks: true };
  // Fixed historical DFS wire format: directories, empty/UTF-8/binary files,
  // byte lengths, relative paths and link text all contribute to this digest.
  const expected = "02cc136f44c61427778c67fd24d06ce5e6bb622d85d02c808491e21f778de9e3";
  assert.equal(await hashResourcePath(options), expected);
  await assert.rejects(() => hashResourcePath({ ...options, allowContainedSymlinks: false }), { code: "RESOURCE_SYMLINK" });
  await fs.chmod(path.join(root, "z.txt"), 0o755);
  assert.equal(await hashResourcePath(options), expected, "historical content digests exclude execute bits; runtime materials bind those separately");
  await fs.writeFile(path.join(root, "b/utf8.txt"), "别\0");
  assert.notEqual(await hashResourcePath(options), expected, "same-length drift must be read on the next invocation");
});
