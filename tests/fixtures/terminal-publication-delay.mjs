// Delay the real supervisor's filesystem boundary after opening a receipt.
// Both direct writeFile and atomic temporary writes exercise the same schedule.
import fs from "node:fs/promises";
import path from "node:path";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const receipt = process.argv[2];
const directory = path.dirname(receipt);
const open = fs.open.bind(fs), writeFile = fs.writeFile.bind(fs);
const trace = (event, file) => appendFileSync(receipt + ".writes", JSON.stringify({ event, file, pid: process.pid, at: Date.now() }) + "\n");
fs.open = async (file, flags, mode) => {
  const handle = await open(file, flags, mode);
  if (path.dirname(String(file)) === directory && flags === "wx") {
    const write = handle.writeFile.bind(handle);
    handle.writeFile = async (...args) => {
      trace("opened-before-write", String(file));
      await delay(200);
      const result = await write(...args);
      trace("written", String(file));
      return result;
    };
  }
  return handle;
};
fs.writeFile = async (file, contents, options) => {
  if (path.dirname(String(file)) !== directory) return writeFile(file, contents, options);
  const handle = await fs.open(file, options?.flag ?? "w", options?.mode);
  try { await handle.writeFile(contents); } finally { await handle.close(); }
};
