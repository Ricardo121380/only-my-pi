import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import readline from "node:readline";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const reply = value => process.stdout.write(JSON.stringify(value) + "\n");
let input, published = false, temporary;
try {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const first = await lines.next(); if (first.done || first.value.length > 15 * 1024 * 1024) throw new Error("IMAGE_EXPORT_INPUT_INVALID");
  input = JSON.parse(first.value);
  if (!/^[^/\\\0\r\n]+\.png$/u.test(input.target) || !/^\.omp-image-[0-9a-f-]{36}\.tmp$/u.test(input.temporary)) throw new Error("IMAGE_EXPORT_PATH_DENIED");
  const bytes = Buffer.from(input.data, "base64"); if (bytes.length > 10485760 || digest(bytes) !== input.sha256) throw new Error("IMAGE_EXPORT_INPUT_INVALID");
  const check = async () => {
    const parent = await fs.stat(".");
    if (parent.dev !== input.parent.dev || parent.ino !== input.parent.ino || await fs.realpath(".") !== input.parentPath) throw new Error("IMAGE_EXPORT_TARGET_CHANGED");
    const stat = await fs.lstat(input.target).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (!input.before) { if (stat) throw new Error("IMAGE_EXPORT_TARGET_CHANGED"); return; }
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 10485760) throw new Error("IMAGE_EXPORT_TARGET_UNSAFE");
    const handle = await fs.open(input.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const s = await handle.stat(); const observed = { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, sha256: digest(await handle.readFile()) }; if (Object.entries(observed).some(([key, value]) => input.before[key] !== value)) throw new Error("IMAGE_EXPORT_TARGET_CHANGED"); }
    finally { await handle.close(); }
  };
  await check(); temporary = input.temporary;
  const output = await fs.open(temporary, "wx", 0o600); try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
  reply({ phase: "ready" });
  const next = await lines.next(); if (next.done || next.value !== '"publish"') throw new Error("IMAGE_EXPORT_NOT_PUBLISHED");
  await check();
  if (input.before) await fs.rename(temporary, input.target);
  else { await fs.link(temporary, input.target); published = true; await fs.unlink(temporary); }
  published = true; temporary = null;
  const directory = await fs.open(".", "r"); try { await directory.sync(); } finally { await directory.close(); }
  const result = await fs.open(input.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const stat = await result.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes.length || digest(await result.readFile()) !== input.sha256) throw new Error("IMAGE_EXPORT_TARGET_CHANGED"); } finally { await result.close(); }
  reply({ phase: "completed", sha256: input.sha256, bytes: bytes.length });
} catch (error) {
  if (temporary && !published) await fs.unlink(temporary).catch(() => {});
  reply({ phase: published ? "unknown" : "failed", error: /^[A-Z_]+$/u.test(error.message) ? error.message : "IMAGE_EXPORT_IO_FAILED" });
} finally { process.stdin.destroy(); }
