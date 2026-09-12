#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNativePackages } from "../packages/distribution/package-builder.mjs";

const options = { rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") };
const names = new Map([["--output", "outputRoot"], ["--seed-bundle", "seedBundle"], ["--source-commit", "sourceCommit"], ["--version", "version"]]);
try {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = names.get(argv[i]);
    if (!key || !argv[i + 1] || Object.hasOwn(options, key)) throw new Error("expected unique --output, --seed-bundle, --source-commit and optional --version values");
    options[key] = argv[i + 1];
  }
  if (!options.sourceCommit || !options.outputRoot || !options.seedBundle) throw new Error("missing required build arguments");
  process.stdout.write(`${JSON.stringify(await buildNativePackages(options), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? "DISTRIBUTION_BUILD_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
