import crypto from "node:crypto";
import fsConstants from "node:fs";
import path from "node:path";

import { immutable } from "../domain/index.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MEDIA_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u;

export class ArtifactStoreError extends Error {
  constructor(message, code = "ARTIFACT_STORE_ERROR", details = {}) {
    super(`artifact-store: ${message}`);
    this.name = "ArtifactStoreError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new ArtifactStoreError(message, code, details);
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} must be a canonical identifier`, "ARTIFACT_INVALID", { value });
  return value;
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical sha256 digest`, "ARTIFACT_INVALID", { value });
  return value;
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`, "ARTIFACT_INVALID");
  return value;
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("artifact path escapes its root", "ARTIFACT_PATH_ESCAPE");
  return path.resolve(target);
}

function bytes(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("artifact contents must be a string, Buffer, or Uint8Array");
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function lstatOrNull(filesystem, target) {
  try { return await filesystem.lstat(target); } catch (cause) { if (cause?.code === "ENOENT") return null; throw cause; }
}

async function ensureDirectory(filesystem, root, target) {
  const safe = contained(root, target);
  await filesystem.mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await filesystem.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("artifact root is not a real directory", "ARTIFACT_PATH_ESCAPE");
  let current = path.resolve(root);
  for (const segment of path.relative(root, safe).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const prior = await lstatOrNull(filesystem, current);
    if (prior?.isSymbolicLink()) fail("artifact directory contains a symlink", "ARTIFACT_PATH_ESCAPE", { current });
    if (prior && !prior.isDirectory()) fail("artifact directory path contains a non-directory", "ARTIFACT_PATH_ESCAPE", { current });
    if (!prior) {
      await filesystem.mkdir(current, { mode: 0o700 });
      const created = await filesystem.lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) fail("artifact directory publication was replaced", "ARTIFACT_PATH_ESCAPE", { current });
    }
  }
  return safe;
}

async function safeFile(filesystem, root, target) {
  const safe = contained(root, target);
  let current = path.resolve(root);
  for (const segment of path.relative(root, safe).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await filesystem.lstat(current);
    if (stat.isSymbolicLink()) fail("artifact path contains a symlink", "ARTIFACT_PATH_ESCAPE", { current });
    if (current !== safe && !stat.isDirectory()) fail("artifact parent is not a directory", "ARTIFACT_PATH_ESCAPE", { current });
  }
  const stat = await filesystem.lstat(safe);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("artifact is not a regular file", "ARTIFACT_PATH_ESCAPE");
  const realRoot = await filesystem.realpath(root);
  const realTarget = await filesystem.realpath(safe);
  contained(realRoot, realTarget);
  return safe;
}

async function syncDirectory(filesystem, directory) {
  let handle;
  try {
    handle = await filesystem.open(directory, fsConstants.constants.O_RDONLY | fsConstants.constants.O_NOFOLLOW);
    await handle.sync?.();
  } finally {
    await handle?.close?.();
  }
}

export function createArtifactStore(options = {}) {
  const filesystem = options.filesystem;
  const rootDir = options.rootDir;
  const maximumBytes = options.maxArtifactBytes ?? 16 * 1024 * 1024;
  if (!filesystem || ["link", "mkdir", "lstat", "open", "readFile", "realpath", "unlink"].some((method) => typeof filesystem[method] !== "function")) throw new TypeError("createArtifactStore requires an injected filesystem");
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir) || rootDir.includes("\0")) throw new TypeError("artifact rootDir must be absolute");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError("maxArtifactBytes must be a positive safe integer");

  async function publish(input) {
    object(input, "artifact publication");
    const data = bytes(input.contents);
    if (data.byteLength > maximumBytes) fail("artifact exceeds configured byte bound", "ARTIFACT_TOO_LARGE", { byteLength: data.byteLength, maximumBytes });
    const runId = id(input.producer?.runId, "producer.runId");
    const revision = input.producer?.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) fail("producer.revision is invalid", "ARTIFACT_INVALID");
    const artifactId = id(input.id, "artifact id");
    const mediaType = input.mediaType;
    if (typeof mediaType !== "string" || !MEDIA_TYPE.test(mediaType) || mediaType.length > 128) fail("artifact mediaType is invalid", "ARTIFACT_INVALID");
    const digest = digestBytes(data);
    const relativePath = `runs/${runId}/${digest.slice(7)}.blob`;
    const directory = await ensureDirectory(filesystem, rootDir, path.join(rootDir, "runs", runId));
    const target = contained(rootDir, path.join(rootDir, ...relativePath.split("/")));
    const existing = await lstatOrNull(filesystem, target);
    if (existing) {
      const safe = await safeFile(filesystem, rootDir, target);
      const current = await filesystem.readFile(safe);
      if (current.byteLength !== data.byteLength || digestBytes(current) !== digest) fail("existing content-addressed artifact is corrupt", "ARTIFACT_DIGEST_MISMATCH");
    } else {
      const temp = contained(rootDir, path.join(directory, `.tmp-${digest.slice(7)}-${crypto.randomUUID()}`));
      let handle;
      try {
        handle = await filesystem.open(temp, fsConstants.constants.O_CREAT | fsConstants.constants.O_EXCL | fsConstants.constants.O_WRONLY | fsConstants.constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(data);
        await handle.sync?.();
        await handle.close();
        handle = null;
        await filesystem.link(temp, target);
        await filesystem.unlink(temp);
        await syncDirectory(filesystem, directory);
      } catch (cause) {
        await handle?.close?.().catch(() => {});
        await filesystem.unlink(temp).catch(() => {});
        if (cause?.code === "EEXIST") {
          const current = await filesystem.readFile(await safeFile(filesystem, rootDir, target));
          if (digestBytes(current) !== digest) fail("artifact publication raced with different bytes", "ARTIFACT_DIGEST_MISMATCH");
        } else throw cause;
      }
    }
    const provenance = object(input.provenance, "artifact provenance");
    if (!["none", "bounded", "digest-only"].includes(provenance.redaction)) fail("artifact redaction is invalid", "ARTIFACT_INVALID");
    const ref = {
      $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/artifact-ref-v1.schema.json",
      formatVersion: 1,
      contractStatus: "runtime-ready",
      kind: "artifact-ref",
      id: artifactId,
      mediaType,
      byteLength: data.byteLength,
      digest,
      producer: {
        runId,
        revision,
        nodeId: id(input.producer.nodeId, "producer.nodeId"),
        attemptId: id(input.producer.attemptId, "producer.attemptId"),
      },
      storage: { scheme: "artifact", relativePath },
      provenance: {
        sourceDigest: sha(provenance.sourceDigest, "provenance.sourceDigest"),
        policyDigest: sha(provenance.policyDigest, "provenance.policyDigest"),
        redaction: provenance.redaction,
      },
    };
    return immutable(ref);
  }

  async function read(ref, readOptions = {}) {
    object(ref, "ArtifactRef");
    if (ref.kind !== "artifact-ref" || ref.formatVersion !== 1 || ref.storage?.scheme !== "artifact") fail("ArtifactRef is invalid", "ARTIFACT_INVALID");
    const maximum = readOptions.maxBytes ?? maximumBytes;
    if (!Number.isSafeInteger(maximum) || maximum < 0 || ref.byteLength > maximum) fail("artifact exceeds read byte bound", "ARTIFACT_TOO_LARGE", { byteLength: ref.byteLength, maximum });
    const expectedPrefix = `runs/${id(ref.producer?.runId, "producer.runId")}/`;
    if (typeof ref.storage.relativePath !== "string" || !ref.storage.relativePath.startsWith(expectedPrefix) || ref.storage.relativePath.includes("..")) fail("ArtifactRef path is outside its producing run", "ARTIFACT_PATH_ESCAPE");
    const target = contained(rootDir, path.join(rootDir, ...ref.storage.relativePath.split("/")));
    const safe = await safeFile(filesystem, rootDir, target);
    const handle = await filesystem.open(safe, fsConstants.constants.O_RDONLY | fsConstants.constants.O_NOFOLLOW);
    let data;
    try { data = await handle.readFile(); } finally { await handle.close(); }
    if (data.byteLength !== ref.byteLength || digestBytes(data) !== ref.digest) fail("artifact bytes differ from ArtifactRef", "ARTIFACT_DIGEST_MISMATCH");
    return data;
  }

  return Object.freeze({ rootDir, maxArtifactBytes: maximumBytes, publish, read });
}
