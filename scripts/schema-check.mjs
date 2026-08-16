#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRepositoryContracts } from "./lib/schema-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function checkSchemas({ rootDir = ROOT } = {}) {
  try {
    const result = validateRepositoryContracts({ rootDir });
    return {
      ok: result.valid,
      documents: result.documents,
      schemas: result.kinds,
      findings: result.results.flatMap((entry) => entry.errors.map((finding) => ({
        kind: entry.kind,
        file: entry.sourcePath,
        instancePath: finding.instancePath,
        keyword: finding.keyword,
        message: finding.message,
      }))),
    };
  } catch (error) {
    return {
      ok: false,
      documents: 0,
      schemas: 0,
      findings: [{ kind: "registry", file: null, instancePath: "", keyword: "registry", message: error.message }],
    };
  }
}

// Backward-compatible export name; unlike the historical implementation this
// performs Draft 2020-12 instance validation and semantic contract checks.
export const checkSchemaLinks = checkSchemas;

function main() {
  const result = checkSchemas();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
