import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  downloadVerified,
  sha256,
  validateDownloadUrl,
  verifyNodeChecksumManifest,
} from "../packages/release-stack/index.mjs";

async function temporary(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-download-test-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function sri(bytes) {
  return `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
}

test("verified downloader streams exact bytes to an atomic destination", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("verified release payload");
  const requests = [];
  const result = await downloadVerified({
    url: "https://github.com/Ricardo121380/only-my-pi/releases/download/v0.2.0-preview.1/payload.tgz",
    destination: path.join(root, "payload.tgz"),
    expectedSha256: sha256(bytes),
    expectedSri: sri(bytes),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(bytes, { status: 200 });
    },
  });
  assert.equal(result.bytes, bytes.length);
  assert.equal(result.redirects, 0);
  assert.equal(await fs.readFile(result.path, "utf8"), bytes.toString());
  assert.deepEqual(requests[0].options, { method: "GET", redirect: "manual", headers: {} });
});

test("build-time acquisition can establish SHA-256 from registry SRI without weakening runtime checks", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("registry artifact");
  const result = await downloadVerified({
    url: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
    destination: path.join(root, "artifact.tgz"),
    expectedSri: sri(bytes),
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  });
  assert.equal(result.sha256, sha256(bytes));
  await assert.rejects(downloadVerified({
    url: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
    destination: path.join(root, "unverified.tgz"),
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  }), { code: "DOWNLOAD_EXPECTATION_INVALID" });
});

test("redirects are manually revalidated against the exact host allowlist", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("redirected");
  let calls = 0;
  const result = await downloadVerified({
    url: "https://github.com/example/release",
    destination: path.join(root, "redirected.tgz"),
    expectedSha256: sha256(bytes),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/exact.tgz" } })
        : new Response(bytes, { status: 200 });
    },
  });
  assert.equal(result.redirects, 1);
  assert.equal(result.finalHost, "release-assets.githubusercontent.com");

  calls = 0;
  await assert.rejects(downloadVerified({
    url: "https://github.com/example/release",
    destination: path.join(root, "unsafe.tgz"),
    expectedSha256: sha256(bytes),
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.invalid/payload.tgz" } }),
  }), { code: "DOWNLOAD_URL_FORBIDDEN" });
});

test("download URLs reject credentials, fragments, HTTP, and non-release hosts", () => {
  for (const url of [
    "https://user:password@github.com/release",
    "https://github.com/release#fragment",
    "http://nodejs.org/archive.tgz",
    "https://127.0.0.1/archive.tgz",
    "https://registry.example.com/archive.tgz",
  ]) assert.throws(() => validateDownloadUrl(url), { code: "DOWNLOAD_URL_FORBIDDEN" });
});

test("digest and size failures leave no published destination", async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from("larger-than-bound");
  const digestTarget = path.join(root, "digest.tgz");
  await assert.rejects(downloadVerified({
    url: "https://nodejs.org/download/release/v24.19.0/archive.tgz",
    destination: digestTarget,
    expectedSha256: sha256("different"),
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  }), { code: "DOWNLOAD_DIGEST_MISMATCH" });
  await assert.rejects(fs.lstat(digestTarget), { code: "ENOENT" });

  const sizeTarget = path.join(root, "size.tgz");
  await assert.rejects(downloadVerified({
    url: "https://nodejs.org/download/release/v24.19.0/archive.tgz",
    destination: sizeTarget,
    expectedSha256: sha256(bytes),
    maxBytes: 4,
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  }), { code: "DOWNLOAD_TOO_LARGE" });
  await assert.rejects(fs.lstat(sizeTarget), { code: "ENOENT" });
});

test("Node checksum manifest binds the official 24.19.0 darwin-arm64 archive", () => {
  const text = [
    "f4e35c13165de6880caa2558c0aa48ca88ada47fe2234bed07d66dbb80a47c8d  node-v24.19.0-aix-ppc64.tar.gz",
    "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d  node-v24.19.0-darwin-arm64.tar.gz",
    "",
  ].join("\n");
  assert.deepEqual(verifyNodeChecksumManifest(text), {
    archiveName: "node-v24.19.0-darwin-arm64.tar.gz",
    sha256: "sha256:8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
  });
  assert.throws(() => verifyNodeChecksumManifest(text.replace("8294", "0000")), { code: "NODE_CHECKSUM_MANIFEST_INVALID" });
  assert.throws(() => verifyNodeChecksumManifest(`${text}${text}`), { code: "NODE_CHECKSUM_MANIFEST_INVALID" });
});
