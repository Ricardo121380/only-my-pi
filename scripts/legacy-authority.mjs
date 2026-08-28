#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildLegacyAuthorityRegistry,
  inspectLegacyAuthority,
  LEGACY_AUTHORITY_PATH,
} from "../packages/release-authority/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(argv = process.argv.slice(2)) {
  const write = argv.includes("--write");
  if (argv.some((entry) => !["--write", "--json"].includes(entry))) throw Object.assign(new Error("unknown argument"), { code: "LEGACY_ARGUMENT_INVALID" });
  if (write) {
    const registry = buildLegacyAuthorityRegistry({ rootDir: ROOT });
    const target = path.join(ROOT, LEGACY_AUTHORITY_PATH);
    await fs.writeFile(target, `${JSON.stringify(registry, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { ok: true, status: "LEGACY_REGISTRY_WRITTEN", entryCount: registry.entries.length, registryDigest: registry.registryDigest };
  }
  return inspectLegacyAuthority({ rootDir: ROOT });
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, status: "LEGACY_AUTHORITY_FAILED", code: error.code ?? "LEGACY_AUTHORITY_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
