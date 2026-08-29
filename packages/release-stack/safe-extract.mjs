import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { hashFile } from "./deterministic-archive.mjs";

const BLOCK = 512;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function string(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  return buffer.subarray(start, end >= start && end < start + length ? end : start + length).toString("utf8");
}

function octal(buffer, start, length) {
  const value = string(buffer, start, length).trim().replace(/\0.*$/u, "");
  if (!/^[0-7]*$/u.test(value)) fail("ARCHIVE_HEADER_INVALID", "tar numeric field is invalid");
  return value === "" ? 0 : Number.parseInt(value, 8);
}

function safeRelative(raw) {
  const portable = raw.replaceAll("\\", "/").replace(/\/+$/u, "");
  const segments = portable.split("/");
  if (!portable || portable.startsWith("/") || portable.includes("\0") || segments.some((segment) => segment === "" || segment === "..")) {
    fail("ARCHIVE_PATH_TRAVERSAL", `tar entry path is unsafe: ${raw}`);
  }
  const normalized = segments.filter((segment) => segment !== ".").join("/");
  if (!normalized) fail("ARCHIVE_PATH_TRAVERSAL", `tar entry path is unsafe: ${raw}`);
  return normalized;
}

function checksum(header) {
  const expected = octal(header, 148, 8);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) fail("ARCHIVE_CHECKSUM_INVALID", "tar entry checksum is invalid");
}

function parsePax(bytes) {
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) fail("ARCHIVE_PAX_INVALID", "PAX record has no length separator");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(lengthText)) fail("ARCHIVE_PAX_INVALID", "PAX record length is invalid");
    const length = Number.parseInt(lengthText, 10);
    if (length < 5 || offset + length > bytes.length || bytes[offset + length - 1] !== 0x0a) fail("ARCHIVE_PAX_INVALID", "PAX record is truncated");
    const body = bytes.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = body.indexOf("=");
    if (equals < 1) fail("ARCHIVE_PAX_INVALID", "PAX record is malformed");
    const key = body.slice(0, equals);
    if (!["path", "linkpath"].includes(key)) fail("ARCHIVE_PAX_UNSUPPORTED", `unsupported PAX key: ${key}`);
    values[key] = body.slice(equals + 1);
    offset += length;
  }
  return values;
}

class ChunkReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.done = false;
  }

  async readExactly(length) {
    while (this.buffer.length < length && !this.done) {
      const next = await this.iterator.next();
      this.done = next.done === true;
      if (!this.done) this.buffer = this.buffer.length === 0 ? Buffer.from(next.value) : Buffer.concat([this.buffer, Buffer.from(next.value)]);
    }
    if (this.buffer.length < length) fail("ARCHIVE_TRUNCATED", "tar archive ended unexpectedly");
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }

  async pipeExactly(length, handle) {
    let remaining = length;
    let position = 0;
    while (remaining > 0) {
      if (this.buffer.length === 0) {
        const next = await this.iterator.next();
        if (next.done) fail("ARCHIVE_TRUNCATED", "tar file content ended unexpectedly");
        this.buffer = Buffer.from(next.value);
      }
      const count = Math.min(remaining, this.buffer.length);
      await handle.write(this.buffer, 0, count, position);
      this.buffer = this.buffer.subarray(count);
      remaining -= count;
      position += count;
    }
  }
}

async function validateParents(root, target) {
  let current = path.dirname(target);
  while (current !== root) {
    const stat = await fsp.lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) fail("ARCHIVE_PARENT_UNSAFE", "tar entry parent is not a real directory");
    current = path.dirname(current);
    if (!current.startsWith(root)) fail("ARCHIVE_PATH_TRAVERSAL", "tar entry parent escapes extraction root");
  }
}

export async function extractVerifiedTarGzip({
  archivePath,
  destination,
  expectedSha256,
  maxEntries = 100_000,
  maxExtractedBytes = 2 * 1024 * 1024 * 1024,
} = {}) {
  if (![archivePath, destination].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new TypeError("archive and destination paths must be absolute");
  const archiveStat = await fsp.lstat(archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) fail("ARCHIVE_SOURCE_UNSAFE", "archive source must be a regular file");
  if (await hashFile(archivePath) !== expectedSha256) fail("ARCHIVE_DIGEST_MISMATCH", "archive SHA-256 differs from the declared value");
  if (await fsp.lstat(destination).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("ARCHIVE_DESTINATION_EXISTS", "archive destination must not exist");
  await fsp.mkdir(destination, { recursive: false, mode: 0o700 });
  const root = await fsp.realpath(destination);
  const reader = new ChunkReader(fs.createReadStream(archivePath).pipe(zlib.createGunzip()));
  const seen = new Set();
  let entries = 0;
  let totalBytes = 0;
  let pendingPax = {};
  let zeroBlocks = 0;
  try {
    while (zeroBlocks < 2) {
      const header = await reader.readExactly(BLOCK);
      if (header.every((byte) => byte === 0)) { zeroBlocks += 1; continue; }
      zeroBlocks = 0;
      checksum(header);
      const prefix = string(header, 345, 155);
      const headerName = [prefix, string(header, 0, 100)].filter(Boolean).join("/");
      const size = octal(header, 124, 12);
      const mode = octal(header, 100, 8);
      const type = string(header, 156, 1) || "0";
      const linkHeader = string(header, 157, 100);
      if (!Number.isSafeInteger(size) || size < 0) fail("ARCHIVE_HEADER_INVALID", "tar entry size is invalid");
      if (type === "x") {
        if (size > 64 * 1024) fail("ARCHIVE_PAX_INVALID", "PAX header exceeds the size bound");
        pendingPax = parsePax(await reader.readExactly(size));
        const pad = (BLOCK - (size % BLOCK)) % BLOCK;
        if (pad) await reader.readExactly(pad);
        continue;
      }
      const relative = safeRelative(pendingPax.path ?? headerName);
      const link = pendingPax.linkpath ?? linkHeader;
      pendingPax = {};
      if (seen.has(relative)) fail("ARCHIVE_DUPLICATE_ENTRY", `duplicate tar entry: ${relative}`);
      seen.add(relative);
      entries += 1;
      if (entries > maxEntries) fail("ARCHIVE_ENTRY_LIMIT", "tar archive contains too many entries");
      totalBytes += size;
      if (totalBytes > maxExtractedBytes) fail("ARCHIVE_EXPANDED_SIZE_LIMIT", "tar archive exceeds the expanded byte bound");
      const target = path.resolve(root, ...relative.split("/"));
      if (target === root || !target.startsWith(`${root}${path.sep}`)) fail("ARCHIVE_PATH_TRAVERSAL", `tar entry escapes destination: ${relative}`);
      await validateParents(root, target);
      if (type === "5") {
        if (size !== 0) fail("ARCHIVE_HEADER_INVALID", "directory entry has non-zero size");
        await fsp.mkdir(target, { recursive: true, mode: 0o755 });
      } else if (type === "2") {
        if (size !== 0) fail("ARCHIVE_HEADER_INVALID", "symlink entry has non-zero size");
        if (path.isAbsolute(link) || link.includes("\0")) fail("ARCHIVE_SYMLINK_UNSAFE", `tar symlink is unsafe: ${relative}`);
        const resolved = path.resolve(path.dirname(target), ...link.replaceAll("\\", "/").split("/"));
        if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) fail("ARCHIVE_SYMLINK_UNSAFE", `tar symlink escapes destination: ${relative}`);
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
        await fsp.symlink(link, target);
      } else if (["0", "7"].includes(type)) {
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
        const handle = await fsp.open(target, "wx", mode & 0o111 ? 0o755 : 0o644);
        try { await reader.pipeExactly(size, handle); } finally { await handle.close(); }
      } else {
        fail("ARCHIVE_ENTRY_TYPE_UNSUPPORTED", `unsupported tar entry type: ${type}`);
      }
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (pad) await reader.readExactly(pad);
    }
    if (Object.keys(pendingPax).length > 0) fail("ARCHIVE_PAX_INVALID", "dangling PAX header");
    return Object.freeze({ ok: true, status: "ARCHIVE_EXTRACTED", entries, extractedBytes: totalBytes, destination: root });
  } catch (error) {
    await fsp.rm(root, { recursive: true, force: true });
    throw error;
  }
}
