import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { createDeterministicTarGzip, extractVerifiedTarGzip, sha256 } from "../packages/release-stack/index.mjs";

const BLOCK = 512;

async function temporary(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function octal(buffer, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`).copy(buffer, offset);
}

function header(name, { type = "0", size = 0, link = "" } = {}) {
  const value = Buffer.alloc(BLOCK);
  Buffer.from(name).copy(value, 0);
  octal(value, 100, 8, 0o644);
  octal(value, 108, 8, 0);
  octal(value, 116, 8, 0);
  octal(value, 124, 12, size);
  octal(value, 136, 12, 0);
  value.fill(0x20, 148, 156);
  Buffer.from(type).copy(value, 156);
  Buffer.from(link).copy(value, 157);
  Buffer.from("ustar\0").copy(value, 257);
  Buffer.from("00").copy(value, 263);
  const sum = value.reduce((total, byte) => total + byte, 0).toString(8).padStart(6, "0");
  Buffer.from(`${sum}\0 `).copy(value, 148);
  return value;
}

function maliciousArchive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.content ?? "");
    blocks.push(header(entry.name, { type: entry.type, size: bytes.length, link: entry.link }));
    if (bytes.length > 0) {
      blocks.push(bytes);
      blocks.push(Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK));
    }
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (Buffer.byteLength(`${length}${body}`) !== length) length = Buffer.byteLength(`${length}${body}`);
  return Buffer.from(`${length}${body}`);
}

test("safe extractor restores normalized archives and executable modes", async (t) => {
  const source = await temporary(t, "omp-extract-source-");
  const output = await temporary(t, "omp-extract-output-");
  await fs.mkdir(path.join(source, "bin"));
  await fs.writeFile(path.join(source, "bin", "tool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(path.join(source, "data"), "payload\n");
  await fs.symlink("bin/tool", path.join(source, "tool-link"));
  const archive = path.join(output, "release.tgz");
  const built = await createDeterministicTarGzip({ rootDir: source, outputPath: archive, rootName: "release" });
  const destination = path.join(output, "extracted");
  const result = await extractVerifiedTarGzip({ archivePath: archive, destination, expectedSha256: built.sha256 });
  assert.equal(await fs.readFile(path.join(destination, "release", "data"), "utf8"), "payload\n");
  assert.equal((await fs.lstat(path.join(destination, "release", "bin", "tool"))).mode & 0o111, 0o111);
  assert.equal(await fs.readlink(path.join(destination, "release", "tool-link")), "bin/tool");
  assert.ok(result.entries >= 4);
});

test("safe extractor rejects path traversal, absolute paths, duplicate entries, and escaping links", async (t) => {
  const root = await temporary(t, "omp-extract-malicious-");
  const cases = [
    ["traversal", [{ name: "../escape", content: "bad" }], "ARCHIVE_PATH_TRAVERSAL"],
    ["absolute", [{ name: "/private/escape", content: "bad" }], "ARCHIVE_PATH_TRAVERSAL"],
    ["duplicate", [{ name: "same", content: "one" }, { name: "same", content: "two" }], "ARCHIVE_DUPLICATE_ENTRY"],
    ["symlink", [{ name: "link", type: "2", link: "../../private" }], "ARCHIVE_SYMLINK_UNSAFE"],
    ["device", [{ name: "device", type: "3" }], "ARCHIVE_ENTRY_TYPE_UNSUPPORTED"],
  ];
  for (const [name, entries, code] of cases) {
    const bytes = maliciousArchive(entries);
    const archive = path.join(root, `${name}.tgz`);
    const destination = path.join(root, `out-${name}`);
    await fs.writeFile(archive, bytes);
    await assert.rejects(extractVerifiedTarGzip({ archivePath: archive, destination, expectedSha256: sha256(bytes) }), { code });
    await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
  }
});

test("safe extractor canonicalizes npm dot segments before duplicate and containment checks", async (t) => {
  const root = await temporary(t, "omp-extract-dot-segment-");
  const bytes = maliciousArchive([{ name: "package/./dist/index.js", content: "export default true;\n" }]);
  const archive = path.join(root, "archive.tgz");
  const destination = path.join(root, "out");
  await fs.writeFile(archive, bytes);
  await extractVerifiedTarGzip({ archivePath: archive, destination, expectedSha256: sha256(bytes) });
  assert.equal(await fs.readFile(path.join(destination, "package", "dist", "index.js"), "utf8"), "export default true;\n");

  const duplicate = maliciousArchive([{ name: "package/./same", content: "one" }, { name: "package/same", content: "two" }]);
  const duplicateArchive = path.join(root, "duplicate.tgz");
  await fs.writeFile(duplicateArchive, duplicate);
  await assert.rejects(extractVerifiedTarGzip({ archivePath: duplicateArchive, destination: path.join(root, "duplicate"), expectedSha256: sha256(duplicate) }), { code: "ARCHIVE_DUPLICATE_ENTRY" });

  const identical = maliciousArchive([{ name: "package/./same", content: "same" }, { name: "package/same", content: "same" }]);
  const identicalArchive = path.join(root, "identical.tgz");
  await fs.writeFile(identicalArchive, identical);
  const accepted = await extractVerifiedTarGzip({ archivePath: identicalArchive, destination: path.join(root, "identical"), expectedSha256: sha256(identical), allowedDuplicateFiles: ["package/same"] });
  assert.deepEqual(accepted.allowedDuplicates, ["package/same"]);
  assert.equal(await fs.readFile(path.join(root, "identical", "package", "same"), "utf8"), "same");

  await assert.rejects(extractVerifiedTarGzip({ archivePath: duplicateArchive, destination: path.join(root, "different"), expectedSha256: sha256(duplicate), allowedDuplicateFiles: ["package/same"] }), { code: "ARCHIVE_DUPLICATE_ENTRY_MISMATCH" });
});

test("safe extractor rejects digest drift, destination reuse, and expansion limits", async (t) => {
  const root = await temporary(t, "omp-extract-bounds-");
  const bytes = maliciousArchive([{ name: "file", content: "0123456789" }]);
  const archive = path.join(root, "archive.tgz");
  await fs.writeFile(archive, bytes);
  await assert.rejects(extractVerifiedTarGzip({ archivePath: archive, destination: path.join(root, "digest"), expectedSha256: sha256("different") }), { code: "ARCHIVE_DIGEST_MISMATCH" });
  await assert.rejects(extractVerifiedTarGzip({ archivePath: archive, destination: path.join(root, "limit"), expectedSha256: sha256(bytes), maxExtractedBytes: 4 }), { code: "ARCHIVE_EXPANDED_SIZE_LIMIT" });
  await fs.mkdir(path.join(root, "exists"));
  await assert.rejects(extractVerifiedTarGzip({ archivePath: archive, destination: path.join(root, "exists"), expectedSha256: sha256(bytes) }), { code: "ARCHIVE_DESTINATION_EXISTS" });
});

test("safe extractor ignores audited npm PAX metadata but rejects unknown namespaces", async (t) => {
  const root = await temporary(t, "omp-extract-pax-");
  const content = Buffer.from("payload");
  const metadata = Buffer.concat([paxRecord("NODETAR.depth", "1"), paxRecord("SCHILY.nlink", "1"), paxRecord("uid", "123")]);
  const bytes = zlib.gzipSync(Buffer.concat([
    header("PaxHeader/package/file", { type: "x", size: metadata.length }), metadata, Buffer.alloc((BLOCK - (metadata.length % BLOCK)) % BLOCK),
    header("package/file", { size: content.length }), content, Buffer.alloc((BLOCK - (content.length % BLOCK)) % BLOCK), Buffer.alloc(BLOCK * 2),
  ]), { level: 9, mtime: 0 });
  const archive = path.join(root, "audited.tgz");
  await fs.writeFile(archive, bytes);
  await extractVerifiedTarGzip({ archivePath: archive, destination: path.join(root, "audited"), expectedSha256: sha256(bytes) });

  const unsafeMetadata = paxRecord("UNTRUSTED.owner", "root");
  const unsafe = zlib.gzipSync(Buffer.concat([header("PaxHeader/file", { type: "x", size: unsafeMetadata.length }), unsafeMetadata, Buffer.alloc((BLOCK - (unsafeMetadata.length % BLOCK)) % BLOCK), Buffer.alloc(BLOCK * 2)]), { level: 9, mtime: 0 });
  const unsafeArchive = path.join(root, "unsafe.tgz");
  await fs.writeFile(unsafeArchive, unsafe);
  await assert.rejects(extractVerifiedTarGzip({ archivePath: unsafeArchive, destination: path.join(root, "unsafe"), expectedSha256: sha256(unsafe) }), { code: "ARCHIVE_PAX_UNSUPPORTED" });
});
