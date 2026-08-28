import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDeterministicTarGzip } from "../packages/release-stack/index.mjs";

async function temporary(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(root, { reverse = false } = {}) {
  const entries = [
    ["bin/tool", "#!/bin/sh\nexit 0\n", 0o755],
    ["lib/data.txt", "deterministic payload\n", 0o644],
    [`lib/${"long-segment-".repeat(12)}.txt`, "long path\n", 0o644],
  ];
  if (reverse) entries.reverse();
  for (const [relative, content, mode] of entries) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { mode });
  }
  await fs.symlink("../bin/tool", path.join(root, "lib", "tool-link"));
}

test("normalized tar.gz is byte-identical across order, mode noise, and mtimes", async (t) => {
  const left = await temporary(t, "omp-archive-left-");
  const right = await temporary(t, "omp-archive-right-");
  const output = await temporary(t, "omp-archive-output-");
  await fixture(left);
  await fixture(right, { reverse: true });
  await fs.chmod(path.join(right, "lib", "data.txt"), 0o600);
  const old = new Date("2020-01-01T00:00:00.000Z");
  const recent = new Date("2026-08-29T00:00:00.000Z");
  await fs.utimes(path.join(left, "lib", "data.txt"), old, old);
  await fs.utimes(path.join(right, "lib", "data.txt"), recent, recent);

  const first = await createDeterministicTarGzip({ rootDir: left, outputPath: path.join(output, "left.tar.gz"), rootName: "release" });
  const second = await createDeterministicTarGzip({ rootDir: right, outputPath: path.join(output, "right.tar.gz"), rootName: "release" });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.entries, second.entries);
});

test("normalized archive preserves executable distinction but not writable mode noise", async (t) => {
  const root = await temporary(t, "omp-archive-mode-");
  const output = await temporary(t, "omp-archive-mode-output-");
  await fs.writeFile(path.join(root, "tool"), "payload\n", { mode: 0o644 });
  const plain = await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(output, "plain.tgz") });
  await fs.chmod(path.join(root, "tool"), 0o600);
  const writableNoise = await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(output, "noise.tgz") });
  assert.equal(plain.sha256, writableNoise.sha256);
  await fs.chmod(path.join(root, "tool"), 0o755);
  const executable = await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(output, "executable.tgz") });
  assert.notEqual(plain.sha256, executable.sha256);
});

test("archive creation rejects symlink escape and unsupported entry types", async (t) => {
  const root = await temporary(t, "omp-archive-unsafe-");
  const output = await temporary(t, "omp-archive-unsafe-output-");
  await fs.symlink("/private", path.join(root, "escape"));
  await assert.rejects(createDeterministicTarGzip({ rootDir: root, outputPath: path.join(output, "escape.tgz") }), { code: "ARCHIVE_SYMLINK_UNSAFE" });
});

test("archive input strips macOS metadata sidecars", async (t) => {
  const root = await temporary(t, "omp-archive-metadata-");
  const output = await temporary(t, "omp-archive-metadata-output-");
  await fs.writeFile(path.join(root, "content"), "payload\n");
  await fs.writeFile(path.join(root, ".DS_Store"), "metadata");
  await fs.writeFile(path.join(root, "._content"), "metadata");
  const withMetadata = await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(output, "with.tgz") });
  await fs.rm(path.join(root, ".DS_Store"));
  await fs.rm(path.join(root, "._content"));
  const clean = await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(output, "clean.tgz") });
  assert.equal(withMetadata.sha256, clean.sha256);
  assert.equal(withMetadata.entries, 2);
});
