#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReleasePayloadStager, sha256 } from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  const error = new Error(message);
  error.code = "RELEASE_STAGE_ARGUMENT_INVALID";
  throw error;
}

function parse(argv) {
  const result = { stage: false, yes: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stage") result.stage = true;
    else if (token === "--yes") result.yes = true;
    else if (token === "--json") result.json = true;
    else if (["--source-commit", "--output"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${token} requires a value`);
      result[token === "--source-commit" ? "sourceCommit" : "outputRoot"] = value;
      index += 1;
    } else fail(`unsupported argument: ${token}`);
  }
  if (!result.sourceCommit || !result.outputRoot) fail("--source-commit and --output are required");
  if (!path.isAbsolute(result.outputRoot)) fail("--output must be absolute");
  if (result.stage !== result.yes) fail("networked staging requires both --stage and --yes");
  return result;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const stager = createReleasePayloadStager({ rootDir: ROOT });
  const plan = await stager.plan(options);
  return options.stage ? stager.apply(options, plan) : plan;
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, status: "RELEASE_STAGE_FAILED", code: error?.code ?? "RELEASE_STAGE_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`);
  process.exitCode = 1;
}
