import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

const BLOCK = 512;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function archivePath(value, { directory = false } = {}) {
  const normalized = value.replaceAll(path.sep, "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("ARCHIVE_PATH_UNSAFE", `archive path is unsafe: ${value}`);
  }
  if (Buffer.byteLength(normalized) > 4096) fail("ARCHIVE_PATH_TOO_LONG", `archive path is too long: ${value}`);
  return directory ? `${normalized}/` : normalized;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

async function collect(root, rootName) {
  const entries = [{ absolute: root, name: archivePath(rootName, { directory: true }), type: "directory", mode: 0o755, size: 0, link: "" }];
  async function visit(directory, relativeParent = "") {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareUtf8(left.name, right.name));
    for (const child of children) {
      if (child.name === ".DS_Store" || child.name.startsWith("._")) continue;
      const relative = relativeParent ? path.posix.join(relativeParent, child.name) : child.name;
      const absolute = path.join(directory, child.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) {
        const link = await fsp.readlink(absolute);
        if (path.isAbsolute(link) || link.includes("\0")) fail("ARCHIVE_SYMLINK_UNSAFE", `archive symlink is absolute or invalid: ${relative}`);
        const resolved = await fsp.realpath(absolute).catch(() => null);
        if (!resolved || !inside(root, resolved)) fail("ARCHIVE_SYMLINK_UNSAFE", `archive symlink escapes payload root: ${relative}`);
        entries.push({ absolute, name: archivePath(path.posix.join(rootName, relative)), type: "symlink", mode: 0o777, size: 0, link: link.replaceAll(path.sep, "/") });
      } else if (stat.isDirectory()) {
        entries.push({ absolute, name: archivePath(path.posix.join(rootName, relative), { directory: true }), type: "directory", mode: 0o755, size: 0, link: "" });
        await visit(absolute, relative);
      } else if (stat.isFile()) {
        if (stat.size > MAX_ENTRY_BYTES) fail("ARCHIVE_ENTRY_TOO_LARGE", `archive entry exceeds the one-GiB bound: ${relative}`);
        entries.push({ absolute, name: archivePath(path.posix.join(rootName, relative)), type: "file", mode: stat.mode & 0o111 ? 0o755 : 0o644, size: stat.size, link: "" });
      } else {
        fail("ARCHIVE_ENTRY_TYPE_UNSUPPORTED", `archive entry type is unsupported: ${relative}`);
      }
    }
  }
  await visit(root);
  return entries;
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.length > length) fail("ARCHIVE_HEADER_OVERFLOW", `tar header value exceeds ${length} bytes`);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = Math.trunc(value).toString(8);
  if (encoded.length > length - 1) fail("ARCHIVE_HEADER_OVERFLOW", "tar numeric header value is too large");
  writeString(buffer, offset, length, `${encoded.padStart(length - 1, "0")}\0`);
}

function splitUstarName(value) {
  if (Buffer.byteLength(value) <= 100) return { name: value, prefix: "" };
  const parts = value.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  return null;
}

function header({ name, mode, size, type, link = "", prefix = "" }) {
  const block = Buffer.alloc(BLOCK);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, mode);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  block.fill(0x20, 148, 156);
  writeString(block, 156, 1, type);
  writeString(block, 157, 100, link);
  writeString(block, 257, 6, "ustar\0");
  writeString(block, 263, 2, "00");
  writeString(block, 345, 155, prefix);
  const checksum = block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  writeString(block, 148, 8, `${checksum}\0 `);
  return block;
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (true) {
    const candidate = `${length}${body}`;
    const actual = Buffer.byteLength(candidate);
    if (actual === length) return Buffer.from(candidate);
    length = actual;
  }
}

function padding(size) {
  const count = (BLOCK - (size % BLOCK)) % BLOCK;
  return count === 0 ? null : Buffer.alloc(count);
}

async function* tarStream(entries) {
  for (const entry of entries) {
    const nameParts = splitUstarName(entry.name);
    const pax = [];
    if (!nameParts) pax.push(paxRecord("path", entry.name));
    if (Buffer.byteLength(entry.link) > 100) pax.push(paxRecord("linkpath", entry.link));
    if (pax.length > 0) {
      const data = Buffer.concat(pax);
      const paxName = `PaxHeaders/${crypto.createHash("sha256").update(entry.name).digest("hex").slice(0, 32)}`;
      yield header({ name: paxName, mode: 0o644, size: data.length, type: "x" });
      yield data;
      const pad = padding(data.length);
      if (pad) yield pad;
    }
    const resolvedName = nameParts ?? { name: `Entry-${crypto.createHash("sha256").update(entry.name).digest("hex").slice(0, 32)}`, prefix: "" };
    yield header({
      ...resolvedName,
      mode: entry.mode,
      size: entry.size,
      type: entry.type === "directory" ? "5" : entry.type === "symlink" ? "2" : "0",
      link: Buffer.byteLength(entry.link) <= 100 ? entry.link : "",
    });
    if (entry.type === "file") {
      const stream = fs.createReadStream(entry.absolute, { highWaterMark: 1024 * 1024 });
      for await (const chunk of stream) yield chunk;
      const pad = padding(entry.size);
      if (pad) yield pad;
    }
  }
  yield Buffer.alloc(BLOCK * 2);
}

export async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

export async function createDeterministicTarGzip({ rootDir, outputPath, rootName = "payload" } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir) || typeof outputPath !== "string" || !path.isAbsolute(outputPath)) throw new TypeError("archive paths must be absolute");
  const root = await fsp.realpath(rootDir);
  const stat = await fsp.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("ARCHIVE_ROOT_UNSAFE", "archive root must be a real directory");
  archivePath(rootName);
  const entries = await collect(root, rootName);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporary = `${outputPath}.tmp-${crypto.randomUUID()}`;
  try {
    await pipeline(
      tarStream(entries),
      zlib.createGzip({ level: 9, mtime: 0, filename: "" }),
      fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    await fsp.rename(temporary, outputPath);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  const output = await fsp.lstat(outputPath);
  return Object.freeze({
    path: outputPath,
    bytes: output.size,
    sha256: await hashFile(outputPath),
    entries: entries.length,
  });
}
