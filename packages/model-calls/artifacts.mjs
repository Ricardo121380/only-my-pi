import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { atomicPublishDirectory } from "../config-runtime/atomic-file.mjs";
import { atomicWriteJson, assertSafeContainedPath, ensureConfigDirectory, readJsonObject, canonicalJson } from "../config-runtime/index.mjs";
import { hostError } from "../host/contracts.mjs";

const fail = code => hostError(code, 409);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; };

// A bounded PNG container check uses Node only; it does not load the gated
// document/image parser resources or execute metadata. Supported output is
// non-interlaced 8-bit RGB/RGBA PNG. Other encodings remain explicitly unavailable.
export function validateImage(block, maximum) {
  if (block?.type !== "image" || block.mimeType !== "image/png" || typeof block.data !== "string") throw fail("IMAGE_FORMAT_UNSUPPORTED");
  if (block.data.length > Math.ceil(maximum / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(block.data)) throw fail("IMAGE_CONTENT_INVALID");
  const bytes = Buffer.from(block.data, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== block.data || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw fail("IMAGE_CONTENT_INVALID");
  let at = 8, width, height, channels, ended = false, dataEnded = false, palette = false; const data = [];
  while (at < bytes.length) {
    if (at + 12 > bytes.length || ended) throw fail("IMAGE_CONTENT_INVALID");
    const length = bytes.readUInt32BE(at), kind = bytes.toString("ascii", at + 4, at + 8), end = at + 12 + length;
    if (end > bytes.length || crc(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw fail("IMAGE_CONTENT_INVALID");
    const chunk = bytes.subarray(at + 8, end - 4);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/u.test(kind) || ["acTL", "fcTL", "fdAT"].includes(kind)) throw fail("IMAGE_FORMAT_UNSUPPORTED");
    if (at === 8 && kind !== "IHDR") throw fail("IMAGE_CONTENT_INVALID");
    if (kind === "IHDR") {
      if (width || length !== 13) throw fail("IMAGE_CONTENT_INVALID");
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); channels = { 2: 3, 6: 4 }[chunk[9]];
      if (!width || !height || width * height > 4000000 || !channels || chunk[8] !== 8 || chunk[10] || chunk[11] || chunk[12]) throw fail("IMAGE_FORMAT_UNSUPPORTED");
    } else if (kind === "IDAT") {
      if (dataEnded) throw fail("IMAGE_CONTENT_INVALID"); data.push(chunk);
    } else if (kind === "IEND") {
      if (length || !data.length) throw fail("IMAGE_CONTENT_INVALID"); ended = true;
    } else if (kind === "PLTE") {
      if (palette || data.length || !length || length > 768 || length % 3) throw fail("IMAGE_CONTENT_INVALID"); palette = true;
    } else {
      if (!/^[a-z][A-Za-z]{3}$/u.test(kind) && kind !== "PLTE") throw fail("IMAGE_FORMAT_UNSUPPORTED");
      if (data.length) dataEnded = true;
    }
    at = end;
  }
  if (!ended) throw fail("IMAGE_CONTENT_INVALID");
  const stride = width * channels + 1, expected = stride * height;
  let pixels;
  try { pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); } catch { throw fail("IMAGE_CONTENT_INVALID"); }
  if (pixels.length !== expected) throw fail("IMAGE_CONTENT_INVALID");
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) throw fail("IMAGE_CONTENT_INVALID");
  return { bytes, width, height, sha256: hash(bytes), mimeType: "image/png" };
}

export class ImageArtifacts {
  constructor(configRoot) { this.root = configRoot; this.directory = path.join(configRoot, "only-my-pi/model-calls/artifacts"); }
  target(requestId) { if (!uuid.test(requestId ?? "")) throw fail("IMAGE_ARTIFACT_ID_INVALID"); return path.join(this.directory, requestId); }
  async save({ projectPath, sessionId, taskId, request, images, budget }) {
    if (typeof sessionId !== "string" || !sessionId) throw fail("IMAGE_SESSION_REQUIRED");
    const target = this.target(request.requestId), total = images.reduce((n, image) => n + image.bytes.length, 0);
    if (!images.length || images.length > budget.maxImagesPerRequest || total > budget.maxStorageBytes) throw fail("IMAGE_STORAGE_LIMIT");
    const artifacts = images.map((image, index) => ({ requestId: request.requestId, index, projectPath, sessionId, taskId, accountId: request.accountId, model: request.model, parentToolCallId: request.parentToolCallId, inputDigest: request.inputDigest, sha256: image.sha256, bytes: image.bytes.length, width: image.width, height: image.height, mimeType: image.mimeType, createdAt: request.createdAt }));
    try {
      await ensureConfigDirectory(this.root, "only-my-pi/model-calls/artifacts");
      const space = await fs.statfs(this.directory);
      if (Number(space.bavail) * Number(space.bsize) < total + 1048576) throw fail("IMAGE_DISK_FULL");
      await atomicPublishDirectory(this.root, target, async ({ temporary }) => {
        for (const [index, image] of images.entries()) {
          const handle = await fs.open(path.join(temporary, `${index}.png`), "wx", 0o600);
          try { await handle.writeFile(image.bytes); await handle.sync(); } finally { await handle.close(); }
        }
        await atomicWriteJson(this.root, path.join(temporary, "manifest.json"), { version: 1, artifacts });
      });
      return { status: "saved", artifacts, bytes: total };
    } catch (error) {
      if (error.atomicPublication === "PUBLISHED_NOT_CONFIRMED_DURABLE") return { status: "unknown", error: "IMAGE_SAVE_UNKNOWN", artifacts, bytes: total };
      if (["ENOSPC", "EDQUOT", "IMAGE_DISK_FULL"].includes(error.code)) throw fail("IMAGE_DISK_FULL");
      throw fail("IMAGE_SAVE_FAILED");
    }
  }
  async read(projectPath, requestId, index, expected) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 3) throw fail("IMAGE_ARTIFACT_ID_INVALID");
    const directory = this.target(requestId), file = path.join(directory, `${index}.png`);
    try {
      await assertSafeContainedPath(this.root, directory, { leafType: "directory" });
      const manifestFile = path.join(directory, "manifest.json"), stat = await fs.lstat(manifestFile);
      if (!stat.isFile() || stat.size > 16384 || stat.nlink !== 1) throw fail("IMAGE_ARTIFACT_CORRUPT");
      const manifest = await readJsonObject(this.root, manifestFile), artifact = manifest.artifacts?.[index];
      if (manifest.version !== 1 || !artifact || artifact.projectPath !== projectPath || artifact.requestId !== requestId || artifact.index !== index || canonicalJson(artifact) !== canonicalJson(expected)) throw fail("IMAGE_ARTIFACT_CORRUPT");
      await assertSafeContainedPath(this.root, file, { leafType: "file" });
      const fileStat = await fs.lstat(file);
      if (!fileStat.isFile() || fileStat.nlink !== 1 || fileStat.size !== artifact.bytes || fileStat.size > 10485760) throw fail("IMAGE_ARTIFACT_CORRUPT");
      const bytes = await fs.readFile(file);
      if (hash(bytes) !== artifact.sha256) throw fail("IMAGE_ARTIFACT_CORRUPT");
      return { artifact, bytes };
    } catch (error) { throw fail(error.code === "ENOENT" ? "IMAGE_ARTIFACT_MISSING" : "IMAGE_ARTIFACT_CORRUPT"); }
  }
}
